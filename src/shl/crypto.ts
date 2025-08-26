// Encryption and decryption functions for Smart Health Links
import { base64url, CompactEncrypt, compactDecrypt } from 'jose'
import { compressDeflateRaw, decompressDeflateRaw } from '../common/compression.js'
import { SHLDecryptionError, SHLError } from './errors.js'
import type { SHLFileContentType } from './types.js'

/**
 * Encrypts content as JWE Compact using A256GCM direct encryption.
 * Follows SHL specification for file encryption.
 *
 * @param params.content - Content to encrypt (string)
 * @param params.key - 32-byte encryption key (base64url-encoded)
 * @param params.contentType - MIME content type for the cty header
 * @param params.enableCompression - Whether to compress with DEFLATE before encryption
 * @returns JWE Compact serialization string
 */
export async function encryptSHLFile(params: {
  content: string
  key: string
  contentType: SHLFileContentType
  enableCompression?: boolean
}): Promise<string> {
  try {
    // Convert content to bytes
    const encoder = new TextEncoder()
    let contentBytes = encoder.encode(params.content)

    // Compress if enabled
    if (params.enableCompression) {
      contentBytes = await compressDeflateRaw(contentBytes)
    }

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Encrypt using jose CompactEncrypt
    // Note: jose library doesn't support zip header, so we handle compression manually
    const protectedHeader = {
      alg: 'dir',
      enc: 'A256GCM',
      cty: params.contentType,
    }
    const jwe = await new CompactEncrypt(contentBytes)
      .setProtectedHeader(protectedHeader)
      .encrypt(keyBytes)

    // If compression was used, we need to manually add the zip header to the JWE
    if (params.enableCompression) {
      // Parse the JWE to add the zip header
      const parts = jwe.split('.')
      if (parts.length !== 5) {
        throw new SHLError('Invalid JWE format from jose library', 'SHL_ENCRYPTION_ERROR')
      }
      const partsTuple = parts as [string, string, string, string, string]

      // Decode, modify, and re-encode the protected header
      const originalHeader = JSON.parse(new TextDecoder().decode(base64url.decode(partsTuple[0])))
      const modifiedHeader = { ...originalHeader, zip: 'DEF' }
      const newHeaderB64u = base64url.encode(
        new TextEncoder().encode(JSON.stringify(modifiedHeader))
      )

      return `${newHeaderB64u}.${partsTuple[1]}.${partsTuple[2]}.${partsTuple[3]}.${partsTuple[4]}`
    }

    return jwe
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLError(`JWE encryption failed: ${errorMessage}`, 'SHL_ENCRYPTION_ERROR')
  }
}

/**
 * Decrypts JWE Compact using A256GCM direct decryption.
 * Follows SHL specification for file decryption.
 *
 * @param params.jwe - JWE Compact serialization string
 * @param params.key - 32-byte decryption key (base64url-encoded)
 * @returns Decrypted content as string
 */
export async function decryptSHLFile(params: {
  jwe: string
  key: string
}): Promise<{ content: string; contentType: string }> {
  try {
    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Decrypt using jose compactDecrypt
    const { plaintext, protectedHeader } = await compactDecrypt(params.jwe, keyBytes)

    // Extract content type from protected header
    const contentType = protectedHeader.cty as string
    if (!contentType) {
      throw new SHLDecryptionError('Missing content type (cty) in JWE protected header')
    }

    // Decompress if zip header indicates DEFLATE compression
    let contentBytes = plaintext
    if (protectedHeader.zip === 'DEF') {
      contentBytes = await decompressDeflateRaw(plaintext)
    }

    // Convert bytes back to string
    const decoder = new TextDecoder()
    const content = decoder.decode(contentBytes)

    return { content, contentType }
  } catch (error) {
    if (error instanceof SHLError) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLDecryptionError(`JWE decryption failed: ${errorMessage}`)
  }
}
