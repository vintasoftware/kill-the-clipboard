import { calculateJwkThumbprint, exportJWK, importJWK, importSPKI } from 'jose'

/**
 * Derives RFC7638 JWK Thumbprint (base64url-encoded SHA-256) from a public key to use as kid
 */
export async function deriveKidFromPublicKey(
  publicKey: CryptoKey | Uint8Array | string | JsonWebKey
): Promise<string> {
  let keyObj: CryptoKey | Uint8Array
  if (typeof publicKey === 'string') {
    keyObj = await importSPKI(publicKey, 'ES256')
  } else if (publicKey && typeof publicKey === 'object' && 'kty' in publicKey) {
    // JsonWebKey object
    keyObj = await importJWK(publicKey, 'ES256')
  } else {
    keyObj = publicKey as CryptoKey | Uint8Array
  }

  const jwk = await exportJWK(keyObj)
  // calculateJwkThumbprint defaults to SHA-256 and returns base64url string in jose v5
  const kid = await calculateJwkThumbprint(jwk)
  return kid
}
