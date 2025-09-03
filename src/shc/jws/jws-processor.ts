// JWT/JWS processing for SMART Health Cards
import {
  base64url,
  CompactSign,
  calculateJwkThumbprint,
  compactVerify,
  decodeProtectedHeader,
  exportJWK,
  importPKCS8,
  importSPKI,
} from 'jose'
import { compressDeflateRaw, decompressDeflateRaw } from '../../common/compression.js'
import { JWSError } from '../errors.js'
import type { SmartHealthCardJWT } from '../types.js'

/**
 * Handles JWT/JWS signing and verification with ES256 algorithm.
 *
 * @public
 * @category Lower-Level API
 */
export class JWSProcessor {
  /**
   * Signs a JWT payload using ES256 algorithm.
   *
   * @param payload - JWT payload to sign
   * @param privateKey - ES256 private key
   * @param publicKey - ES256 public key (for key ID derivation)
   * @param config.enableCompression - Whether to compress payload with raw DEFLATE (default: true).
   *  When `enableCompression` is true, compresses payload before signing and sets `zip: "DEF"`.
   * @returns Promise resolving to JWS string
   * @throws {@link JWSError} When signing fails, key import fails, or payload is invalid
   */
  async sign(
    payload: SmartHealthCardJWT,
    privateKey: CryptoKey | Uint8Array | string,
    publicKey: CryptoKey | Uint8Array | string,
    config: { enableCompression?: boolean } = {}
  ): Promise<string> {
    try {
      // Validate required payload fields
      this.validateJWTPayload(payload)

      // Derive kid from public key
      const kid = await this.deriveKidFromPublicKey(publicKey)

      // Protected header per SMART Health Cards
      const header: { alg: 'ES256'; kid: string; zip?: 'DEF' } = {
        alg: 'ES256',
        kid,
      }

      // Serialize payload
      const payloadJson = JSON.stringify(payload)
      const encoder = new TextEncoder()
      let payloadBytes = encoder.encode(payloadJson)

      // Compress the payload BEFORE signing using raw DEFLATE (zip: "DEF")
      const enableCompression = config.enableCompression ?? true
      if (enableCompression) {
        payloadBytes = await compressDeflateRaw(payloadBytes)
        header.zip = 'DEF'
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof privateKey === 'string') {
        key = await importPKCS8(privateKey, 'ES256')
      } else {
        key = privateKey
      }

      // Build compact JWS (base64url(header) + '.' + base64url(payloadBytes))
      const jws = await new CompactSign(payloadBytes).setProtectedHeader(header).sign(key)
      return jws
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS signing failed: ${errorMessage}`)
    }
  }

  /**
   * Derives RFC7638 JWK Thumbprint (base64url-encoded SHA-256) from a public key to use as kid
   */
  private async deriveKidFromPublicKey(
    publicKey: CryptoKey | Uint8Array | string
  ): Promise<string> {
    let keyObj: CryptoKey | Uint8Array
    if (typeof publicKey === 'string') {
      keyObj = await importSPKI(publicKey, 'ES256')
    } else {
      keyObj = publicKey
    }

    const jwk = await exportJWK(keyObj)
    // calculateJwkThumbprint defaults to SHA-256 and returns base64url string in jose v5
    const kid = await calculateJwkThumbprint(jwk)
    return kid
  }

  /**
   * Verifies a JWS and returns the decoded payload.
   *
   * @param jws - JWS string to verify
   * @param publicKey - ES256 public key for verification
   * @param config.verifyExpiration - Whether to verify the JWT `exp` claim during verification.
   *  When true (default), expired health cards will be rejected.
   *  Set to false to allow expired cards to be accepted.
   * @returns Promise resolving to decoded JWT payload
   * @throws {@link JWSError} When verification fails or JWS is invalid
   *
   * @remarks To inspect headers without verification, use `jose.decodeProtectedHeader(jws)` from the `jose` library.
   */
  async verify(
    jws: string,
    publicKey: CryptoKey | Uint8Array | string,
    config?: { verifyExpiration?: boolean }
  ): Promise<SmartHealthCardJWT> {
    try {
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof publicKey === 'string') {
        key = await importSPKI(publicKey, 'ES256')
      } else {
        key = publicKey
      }

      // Verify signature over original compact JWS
      const { payload, protectedHeader } = await compactVerify(jws, key)

      // Decompress payload if zip: 'DEF'
      let payloadBytes = payload
      if (protectedHeader.zip === 'DEF') {
        payloadBytes = await decompressDeflateRaw(payload)
      }

      // Parse JSON
      const payloadJson = new TextDecoder().decode(payloadBytes)
      const smartPayload = JSON.parse(payloadJson) as SmartHealthCardJWT

      // Validate structure
      this.validateJWTPayload(smartPayload)

      // Enforce expiration if present (if enabled)
      const verifyExpiration = config?.verifyExpiration ?? true
      if (verifyExpiration) {
        const nowSeconds = Math.floor(Date.now() / 1000)
        if (typeof smartPayload.exp === 'number' && smartPayload.exp < nowSeconds) {
          throw new JWSError('SMART Health Card has expired')
        }
      }

      return smartPayload
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS verification failed: ${errorMessage}`)
    }
  }

  /**
   * Validates the structure of a SMART Health Card JWT payload
   */
  private validateJWTPayload(payload: SmartHealthCardJWT): void {
    if (!payload || typeof payload !== 'object') {
      throw new JWSError('Invalid JWT payload: must be an object')
    }

    // Validate required fields per SMART Health Cards spec
    if (!payload.iss || typeof payload.iss !== 'string') {
      throw new JWSError("Invalid JWT payload: 'iss' (issuer) is required and must be a string")
    }

    if (!payload.nbf || typeof payload.nbf !== 'number') {
      throw new JWSError("Invalid JWT payload: 'nbf' (not before) is required and must be a number")
    }

    // exp is optional but if present must be a number
    if (payload.exp !== undefined && typeof payload.exp !== 'number') {
      throw new JWSError("Invalid JWT payload: 'exp' (expiration) must be a number if provided")
    }

    // Validate exp > nbf if both are present
    if (payload.exp && payload.exp <= payload.nbf) {
      throw new JWSError("Invalid JWT payload: 'exp' must be greater than 'nbf'")
    }

    if (!payload.vc || typeof payload.vc !== 'object') {
      throw new JWSError(
        "Invalid JWT payload: 'vc' (verifiable credential) is required and must be an object"
      )
    }
  }

  /**
   * Parses a Compact JWS without verifying its signature to extract protected header and payload.
   * If the header indicates zip: 'DEF', the payload will be decompressed.
   * This is safe for metadata discovery (e.g., resolving JWKS by iss/kid) but MUST NOT be used to trust content.
   */
  async parseUnverified(
    jws: string
  ): Promise<{ header: { kid?: string; zip?: 'DEF' | string }; payload: SmartHealthCardJWT }> {
    try {
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      const parts = jws.split('.')
      if (parts.length !== 3) {
        throw new JWSError('Invalid Compact JWS')
      }

      const header = decodeProtectedHeader(jws) as { kid?: string; zip?: 'DEF' | string }

      const payloadB64u = parts[1] as string
      const payloadBytes = base64url.decode(payloadB64u)

      const decompressed =
        header.zip === 'DEF' ? await decompressDeflateRaw(payloadBytes) : payloadBytes
      const json = new TextDecoder().decode(decompressed)
      const payload = JSON.parse(json) as SmartHealthCardJWT

      return { header, payload }
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new JWSError(`Failed to parse JWS: ${message}`)
    }
  }
}
