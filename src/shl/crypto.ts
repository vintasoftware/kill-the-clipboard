// Encryption and decryption functions for SMART Health Links
import { base64url, CompactEncrypt, compactDecrypt } from 'jose'
import { compressDeflateRaw, decompressDeflateRaw } from '../common/compression.js'
import { SHLDecryptionError, SHLError } from './errors.js'
import type { SHLFileContentType } from './types.js'

/**
 * Manual JWE encryption using A256GCM to bypass jose's zip header validation
 */
async function encryptA256GCM(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  additionalData: Uint8Array
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  // Convert Uint8Array to proper ArrayBuffer for Web Crypto API
  const keyBuffer = new ArrayBuffer(key.length)
  new Uint8Array(keyBuffer).set(key)

  const ivBuffer = new ArrayBuffer(iv.length)
  new Uint8Array(ivBuffer).set(iv)

  const plaintextBuffer = new ArrayBuffer(plaintext.length)
  new Uint8Array(plaintextBuffer).set(plaintext)

  const aadBuffer = new ArrayBuffer(additionalData.length)
  new Uint8Array(aadBuffer).set(additionalData)

  // Import key for AES-256-GCM
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  // Encrypt with AES-256-GCM
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer,
      additionalData: aadBuffer,
    },
    cryptoKey,
    plaintextBuffer
  )

  // Split result into ciphertext + tag (GCM tag is last 16 bytes)
  const encryptedArray = new Uint8Array(encrypted)
  const ciphertext = encryptedArray.slice(0, -16)
  const tag = encryptedArray.slice(-16)

  return { ciphertext, tag }
}

/**
 * Generate random IV for AES-256-GCM (96 bits / 12 bytes)
 */
function generateIV(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(12))
}

/**
 * Manual JWE decryption using A256GCM to handle zip headers that newer jose can't process
 */
async function decryptA256GCM(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  additionalData: Uint8Array
): Promise<Uint8Array> {
  // Convert Uint8Array to proper ArrayBuffer for Web Crypto API
  const keyBuffer = new ArrayBuffer(key.length)
  new Uint8Array(keyBuffer).set(key)

  const ivBuffer = new ArrayBuffer(iv.length)
  new Uint8Array(ivBuffer).set(iv)

  const aadBuffer = new ArrayBuffer(additionalData.length)
  new Uint8Array(aadBuffer).set(additionalData)

  // Combine ciphertext + tag for GCM decryption
  const encryptedData = new Uint8Array(ciphertext.length + tag.length)
  encryptedData.set(ciphertext, 0)
  encryptedData.set(tag, ciphertext.length)

  const encryptedBuffer = new ArrayBuffer(encryptedData.length)
  new Uint8Array(encryptedBuffer).set(encryptedData)

  // Import key for AES-256-GCM
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  // Decrypt with AES-256-GCM
  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer,
      additionalData: aadBuffer,
    },
    cryptoKey,
    encryptedBuffer
  )

  return new Uint8Array(decrypted)
}

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
 *   Uses the same compression approach as jose 4.x.x for maximum compatibility.
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
    let contentBytes = encoder.encode(params.content)

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Compress plaintext if enabled (matches jose 4.x.x: compress BEFORE encryption)
    if (params.enableCompression) {
      const compressedBytes = await compressDeflateRaw(contentBytes)
      contentBytes = new Uint8Array(compressedBytes)
    }

    if (params.enableCompression) {
      // Manual JWE construction for compression compatibility with jose 4.13.1
      const protectedHeader = {
        alg: 'dir' as const,
        enc: 'A256GCM' as const,
        cty: params.contentType,
        zip: 'DEF' as const,
      }

      // Encode protected header
      const protectedHeaderJson = JSON.stringify(protectedHeader)
      const protectedHeaderBytes = encoder.encode(protectedHeaderJson)
      const protectedHeaderB64u = base64url.encode(protectedHeaderBytes)

      // Generate IV
      const iv = generateIV()

      // Prepare AAD (Additional Authenticated Data) = base64url(protectedHeader)
      const aad = encoder.encode(protectedHeaderB64u)

      // Encrypt using manual A256GCM
      const { ciphertext, tag } = await encryptA256GCM(contentBytes, keyBytes, iv, aad)

      // Build JWE Compact: protected.encryptedKey.iv.ciphertext.tag
      // For direct encryption (alg: 'dir'), encrypted key is empty
      return [
        protectedHeaderB64u,
        '', // empty encrypted key for 'dir' algorithm
        base64url.encode(iv),
        base64url.encode(ciphertext),
        base64url.encode(tag),
      ].join('.')
    } else {
      // Use standard jose for non-compressed content
      const protectedHeader = {
        alg: 'dir' as const,
        enc: 'A256GCM' as const,
        cty: params.contentType,
      }

      const jwe = await new CompactEncrypt(contentBytes)
        .setProtectedHeader(protectedHeader)
        .encrypt(keyBytes)

      return jwe
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLError(`JWE encryption failed: ${errorMessage}`, 'SHL_ENCRYPTION_ERROR')
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
 * // Decrypt a file (automatically handles both compressed and uncompressed JWEs)
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

    // Parse the JWE header to check for compression
    let hasZipHeader = false
    let originalHeader: { alg: string; enc: string; cty?: string; zip?: string } | null = null
    try {
      const parts = params.jwe.split('.')
      if (parts.length === 5 && parts[0]) {
        originalHeader = JSON.parse(new TextDecoder().decode(base64url.decode(parts[0])))
        hasZipHeader = originalHeader?.zip === 'DEF'
      }
    } catch (_headerError) {
      // If we can't parse the header, continue without compression info
      // jose will handle the error appropriately
    }

    let plaintext: Uint8Array
    let contentType: string | undefined

    if (hasZipHeader) {
      // Use manual decryption for JWEs with zip headers (compatible with both our JWEs and jose 4.13.1 JWEs)
      const parts = params.jwe.split('.')
      if (parts.length === 5 && parts[0] && parts[2] && parts[3] && parts[4]) {
        // Parse JWE components
        const protectedHeaderB64u = parts[0]
        // parts[1] is encrypted_key (empty for 'dir' algorithm)
        const ivBytes = base64url.decode(parts[2])
        const ciphertextBytes = base64url.decode(parts[3])
        const tagBytes = base64url.decode(parts[4])

        // Prepare AAD (Additional Authenticated Data) = base64url(protectedHeader)
        const encoder = new TextEncoder()
        const aad = encoder.encode(protectedHeaderB64u)

        // Manual decryption with original protected header (preserves AAD integrity)
        const compressedPlaintext = await decryptA256GCM(
          ciphertextBytes,
          keyBytes,
          ivBytes,
          tagBytes,
          aad
        )

        // Decompress the plaintext
        plaintext = await decompressDeflateRaw(compressedPlaintext)
        contentType = originalHeader?.cty
      } else {
        throw new SHLDecryptionError('Invalid JWE format')
      }
    } else {
      // No compression, use standard jose decryption
      const result = await compactDecrypt(params.jwe, keyBytes)
      plaintext = result.plaintext
      contentType = result.protectedHeader.cty
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
