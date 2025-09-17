// Encryption and decryption functions for SMART Health Links
import { base64url, CompactEncrypt, compactDecrypt } from 'jose'
// Import jose 4.x.x for compression support (jose dropped zip support at 5.0.0)
import { CompactEncrypt as CompactEncryptV4, compactDecrypt as compactDecryptV4 } from 'jose-v4'
import { SHLDecryptionError, SHLEncryptionError } from './errors.js'
import type { SHLFileContentType } from './types.js'

/**
 * Encrypts content as JWE Compact using A256GCM direct encryption.
 *
 * Follows the SMART Health Links specification for file encryption using:
 * - Direct key agreement (alg: 'dir')
 * - AES-256-GCM encryption (enc: 'A256GCM')
 * - Optional raw DEFLATE compression (zip: 'DEF')
 * - Content type in protected header (cty: contentType)
 *
 * @param params.content - Content to encrypt as a UTF-8 string
 * @param params.key - 256-bit encryption key encoded as base64url (43 characters).
 *   Should be generated using cryptographically secure random bytes.
 * @param params.contentType - MIME content type for the cty header.
 *   Used by decryption to identify file format. Typically 'application/smart-health-card' or 'application/fhir+json'.
 * @param params.enableCompression - Whether to compress content with raw DEFLATE before encryption.
 *   Recommended for verbose content like FHIR JSON. Not recommended for already-compressed content like SMART Health Cards.
 * @returns JWE Compact serialization string (5 base64url parts separated by dots)
 * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
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
 * // Encrypt SMART Health Card without compression
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
 * @group SHL
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
    const contentBytes = encoder.encode(params.content)

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Use jose 4.x.x CompactEncrypt when compression is enabled (jose since 5.0.0 dropped zip support)
    if (params.enableCompression) {
      // Decode the base64url key to raw bytes using jose 4.x.x base64url
      const keyBytes = base64url.decode(params.key)

      // Use jose 4.x.x CompactEncrypt with built-in compression support
      const protectedHeader = {
        alg: 'dir',
        enc: 'A256GCM',
        cty: params.contentType,
        zip: 'DEF', // Enable DEFLATE compression
      }
      const jwe = await new CompactEncryptV4(contentBytes)
        .setProtectedHeader(protectedHeader)
        .encrypt(keyBytes)

      return jwe
    }

    // Use current jose 6.x.x CompactEncrypt for non-compressed content

    // Encrypt using jose CompactEncrypt without compression
    const protectedHeader = {
      alg: 'dir',
      enc: 'A256GCM',
      cty: params.contentType,
    }
    const jwe = await new CompactEncrypt(contentBytes)
      .setProtectedHeader(protectedHeader)
      .encrypt(keyBytes)

    return jwe
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLEncryptionError(`JWE encryption failed: ${errorMessage}`)
  }
}

/**
 * Decrypts JWE Compact using A256GCM direct decryption.
 *
 * Follows the SMART Health Links specification for file decryption.
 * The function:
 * 1. Decrypts the JWE using the provided key
 * 2. Extracts the content type from the cty header
 * 3. Decompresses the content if zip=DEF is present
 * 4. Returns the plaintext content and content type
 *
 * @param params.jwe - JWE Compact serialization string (5 base64url parts separated by dots)
 * @param params.key - 256-bit decryption key encoded as base64url (43 characters).
 *   Must be the same key used for encryption.
 * @returns Promise resolving to decrypted file object with `content` and `contentType`
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
 * @group SHL
 * @category Lower-Level API
 */
export async function decryptSHLFile(params: {
  jwe: string
  key: string
}): Promise<{ content: string; contentType: string | undefined }> {
  try {
    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Check if the JWE has a zip header to determine which jose version to use
    let hasZipHeader = false

    try {
      const parts = params.jwe.split('.')
      if (parts.length === 5) {
        const headerPart = parts[0]
        if (headerPart) {
          const header = JSON.parse(new TextDecoder().decode(base64url.decode(headerPart)))
          if (header.zip === 'DEF') {
            hasZipHeader = true
          }
        }
      }
    } catch (_headerError) {
      // If we can't parse the header, continue with jose 6.x.x
    }

    // Use jose 4.x.x for compressed content (has built-in zip support)
    if (hasZipHeader) {
      // Decode the base64url key to raw bytes using jose 4.x.x base64url
      const keyBytes = base64url.decode(params.key)

      // Decrypt using jose 4.x.x compactDecrypt (supports zip=DEF)
      const { plaintext, protectedHeader } = await compactDecryptV4(params.jwe, keyBytes)

      // Extract content type from protected header
      const contentType = protectedHeader.cty

      // Convert bytes back to string (jose 4.x.x handles decompression automatically)
      const decoder = new TextDecoder()
      const content = decoder.decode(plaintext)

      return { content, contentType }
    }

    // Use jose 6.x.x for non-compressed content

    // Decrypt using jose compactDecrypt
    const { plaintext, protectedHeader } = await compactDecrypt(params.jwe, keyBytes)

    // Extract content type from protected header
    const contentType = protectedHeader.cty

    // Convert bytes back to string
    const decoder = new TextDecoder()
    const content = decoder.decode(plaintext)

    return { content, contentType }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLDecryptionError(`JWE decryption failed: ${errorMessage}`)
  }
}
