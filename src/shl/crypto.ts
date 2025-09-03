// Encryption and decryption functions for Smart Health Links
import { base64url, CompactEncrypt, compactDecrypt } from 'jose'
import { compressDeflateRaw, decompressDeflateRaw } from '../common/compression.js'
import { SHLDecryptionError, SHLError } from './errors.js'
import type { SHLFileContentType } from './types.js'

/**
 * Encrypts content as JWE Compact using A256GCM direct encryption.
 *
 * Follows the Smart Health Links specification for file encryption using:
 * - Direct key agreement (alg: 'dir')
 * - AES-256-GCM encryption (enc: 'A256GCM')
 * - Optional raw DEFLATE compression (zip: 'DEF')
 * - Content type in protected header (cty: contentType)
 *
 * The function handles compression manually since the jose library doesn't
 * support the zip header parameter. When compression is enabled, the content
 * is compressed first, then encrypted, and the zip header is added to the
 * protected header after encryption.
 *
 * @param params.content - Content to encrypt as a UTF-8 string
 * @param params.key - 256-bit encryption key encoded as base64url (43 characters).
 *   Should be generated using cryptographically secure random bytes.
 * @param params.contentType - MIME content type for the cty header.
 *   Used by decryption to identify file format. Typically 'application/smart-health-card' or 'application/fhir+json'.
 * @param params.enableCompression - Whether to compress content with raw DEFLATE before encryption.
 *   Recommended for verbose content like FHIR JSON. Not recommended for already-compressed content like Smart Health Cards.
 * @returns JWE Compact serialization string (5 base64url parts separated by dots)
 * @throws {@link SHLError} When encryption fails due to invalid key, content, or crypto operations
 *
 * @example
 * ```typescript
 * // Encrypt FHIR resource with compression
 * const fhirJson = JSON.stringify(myFhirBundle);
 * const jwe = await encryptSHLFile({
 *   content: fhirJson,
 *   key: 'abc123...', // 43-char base64url key
 *   contentType: 'application/fhir+json',
 *   enableCompression: true
 * });
 *
 * // Encrypt Smart Health Card without compression
 * const shcJson = JSON.stringify({ verifiableCredential: [jwsString] });
 * const jwe = await encryptSHLFile({
 *   content: shcJson,
 *   key: 'abc123...', // same key as above
 *   contentType: 'application/smart-health-card',
 *   enableCompression: false
 * });
 * ```
 *
 * @public
 * @category Lower-Level API
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
 *
 * Follows the Smart Health Links specification for file decryption.
 * Handles both compressed and uncompressed content automatically based
 * on the zip header in the JWE protected header.
 *
 * The function:
 * 1. Decrypts the JWE using the provided key
 * 2. Extracts the content type from the cty header
 * 3. Decompresses the content if zip=DEF is present
 * 4. Returns the plaintext content and content type
 *
 * @param params.jwe - JWE Compact serialization string (5 base64url parts separated by dots)
 * @param params.key - 256-bit decryption key encoded as base64url (43 characters).
 *   Must be the same key used for encryption.
 * @returns Promise resolving to object with decrypted content and content type
 * @returns returns.content - Decrypted content as UTF-8 string
 * @returns returns.contentType - Content type from JWE cty header
 * @throws {@link SHLDecryptionError} When JWE decryption fails due to invalid key, malformed JWE, or missing content type
 * @throws {@link SHLDecryptionError} When decompression fails for zip=DEF content
 *
 * @example
 * ```typescript
 * // Decrypt a file
 * const { content, contentType } = await decryptSHLFile({
 *   jwe: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIiwiY3R5IjoiYXBwbGljYXRpb24vZmhpcitqc29uIn0...',
 *   key: 'abc123...' // same key used for encryption
 * });
 *
 * if (contentType === 'application/fhir+json') {
 *   const fhirResource = JSON.parse(content);
 *   console.log('Resource type:', fhirResource.resourceType);
 * } else if (contentType === 'application/smart-health-card') {
 *   const shcFile = JSON.parse(content);
 *   console.log('Verifiable credentials:', shcFile.verifiableCredential);
 * }
 * ```
 *
 * @public
 * @category Lower-Level API
 */
export async function decryptSHLFile(params: {
  jwe: string
  key: string
}): Promise<{ content: string; contentType: string }> {
  try {
    // Check if the JWE has a zip header and handle it manually
    // since jose library doesn't support zip headers
    let jweToDecrypt = params.jwe
    let hasZipHeader = false

    try {
      const parts = jweToDecrypt.split('.')
      if (parts.length === 5) {
        const headerPart = parts[0]
        if (headerPart) {
          const header = JSON.parse(new TextDecoder().decode(base64url.decode(headerPart)))
          if (header.zip === 'DEF') {
            hasZipHeader = true
            // Remove the zip header before passing to jose
            const { zip: _zip, ...headerWithoutZip } = header
            const newHeaderB64u = base64url.encode(
              new TextEncoder().encode(JSON.stringify(headerWithoutZip))
            )
            jweToDecrypt = `${newHeaderB64u}.${parts[1]}.${parts[2]}.${parts[3]}.${parts[4]}`
          }
        }
      }
    } catch (_headerError) {
      // If we can't parse the header, continue with original JWE
      // jose will handle the error appropriately
    }

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Decrypt using jose compactDecrypt
    const { plaintext, protectedHeader } = await compactDecrypt(jweToDecrypt, keyBytes)

    // Extract content type from protected header
    const contentType = protectedHeader.cty as string
    if (!contentType) {
      throw new SHLDecryptionError('Missing content type (cty) in JWE protected header')
    }

    // Decompress if zip header was present in original JWE
    let contentBytes = plaintext
    if (hasZipHeader) {
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
