// Encryption and decryption functions for Smart Health Links
import { base64url, CompactEncrypt, compactDecrypt } from 'jose'
import { SHLDecryptionError, SHLError } from './errors.js'
import type { SHLFileContentType } from './types.js'

/**
 * Encrypts content as JWE Compact using A256GCM direct encryption.
 *
 * Follows the Smart Health Links specification for file encryption using:
 * - Direct key agreement (alg: 'dir')
 * - AES-256-GCM encryption (enc: 'A256GCM')
 * - Content type in protected header (cty: contentType)
 *
 * @param params.content - Content to encrypt as a UTF-8 string
 * @param params.key - 256-bit encryption key encoded as base64url (43 characters).
 *   Should be generated using cryptographically secure random bytes.
 * @param params.contentType - MIME content type for the cty header.
 *   Used by decryption to identify file format. Typically 'application/smart-health-card' or 'application/fhir+json'.
 * @returns JWE Compact serialization string (5 base64url parts separated by dots)
 * @throws {@link SHLError} When encryption fails due to invalid key, content, or crypto operations
 *
 * @example
 * ```typescript
 * // Encrypt FHIR resource
 * const fhirJson = JSON.stringify(myFhirBundle);
 * const jwe = await encryptSHLFile({
 *   content: fhirJson,
 *   key: 'abc123...', // 43-char base64url key
 *   contentType: 'application/fhir+json'
 * });
 *
 * // Encrypt Smart Health Card
 * const shcJson = JSON.stringify({ verifiableCredential: [jwsString] });
 * const jwe = await encryptSHLFile({
 *   content: shcJson,
 *   key: 'abc123...', // same key as above
 *   contentType: 'application/smart-health-card'
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
}): Promise<string> {
  try {
    // Convert content to bytes
    const encoder = new TextEncoder()
    const contentBytes = encoder.encode(params.content)

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Encrypt using jose CompactEncrypt
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
    throw new SHLError(`JWE encryption failed: ${errorMessage}`, 'SHL_ENCRYPTION_ERROR')
  }
}

/**
 * Decrypts JWE Compact using A256GCM direct decryption.
 *
 * Follows the Smart Health Links specification for file decryption.
 * The function:
 * 1. Decrypts the JWE using the provided key
 * 2. Extracts the content type from the cty header
 * 3. Returns the plaintext content and content type
 *
 * @param params.jwe - JWE Compact serialization string (5 base64url parts separated by dots)
 * @param params.key - 256-bit decryption key encoded as base64url (43 characters).
 *   Must be the same key used for encryption.
 * @returns Promise resolving to object with decrypted content and content type
 * @returns returns.content - Decrypted content as UTF-8 string
 * @returns returns.contentType - Content type from JWE cty header
 * @throws {@link SHLDecryptionError} When JWE decryption fails due to invalid key, malformed JWE, or missing content type
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

    // Convert bytes back to string
    const decoder = new TextDecoder()
    const content = decoder.decode(plaintext)

    return { content, contentType }
  } catch (error) {
    if (error instanceof SHLError) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLDecryptionError(`JWE decryption failed: ${errorMessage}`)
  }
}
