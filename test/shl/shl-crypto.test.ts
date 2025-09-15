import { base64url } from 'jose'
import { describe, expect, it } from 'vitest'
import { decryptSHLFile, encryptSHLFile, SHLDecryptionError, SHLError } from '@/index'

function generateB64uKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url.encode(bytes)
}

describe('SHL Crypto', () => {
  it('encrypts and decrypts content, preserves cty', async () => {
    const key = generateB64uKey()
    const content = JSON.stringify({ foo: 'bar' })
    const contentType = 'application/fhir+json' as const

    const jwe = await encryptSHLFile({ content, key, contentType })
    expect(jwe.split('.')).toHaveLength(5)

    const { content: decrypted, contentType: cty } = await decryptSHLFile({ jwe, key })
    expect(cty).toBe(contentType)
    expect(decrypted).toBe(content)
  })

  it('encrypts with compression and decrypts, sets zip=DEF header', async () => {
    const key = generateB64uKey()
    const content = JSON.stringify({ big: 'x'.repeat(2000) })
    const contentType = 'application/fhir+json' as const

    const jwe = await encryptSHLFile({ content, key, contentType, enableCompression: true })
    const [protectedHeaderB64u] = jwe.split('.')
    const headerJson = new TextDecoder().decode(base64url.decode(protectedHeaderB64u as string))
    const header = JSON.parse(headerJson) as Record<string, unknown>
    expect(header.zip).toBe('DEF')
    expect(header.cty).toBe(contentType)

    const { content: decrypted, contentType: cty } = await decryptSHLFile({ jwe, key })
    expect(cty).toBe(contentType)
    expect(decrypted).toBe(content)
  })

  it('fails decryption with wrong key', async () => {
    const key = generateB64uKey()
    const wrongKey = generateB64uKey()
    const content = JSON.stringify({ foo: 'bar' })
    const contentType = 'application/fhir+json' as const

    const jwe = await encryptSHLFile({ content, key, contentType })
    await expect(decryptSHLFile({ jwe, key: wrongKey })).rejects.toThrow(SHLDecryptionError)
    await expect(decryptSHLFile({ jwe, key: wrongKey })).rejects.toThrow(/JWE decryption failed/)
  })

  it('encryption errors surface as SHLError for invalid key size', async () => {
    const badKey = base64url.encode(new Uint8Array(16)) // 128-bit, not allowed
    const content = JSON.stringify({ foo: 'bar' })
    await expect(
      encryptSHLFile({ content, key: badKey, contentType: 'application/fhir+json' })
    ).rejects.toThrow(SHLError)
    await expect(
      encryptSHLFile({ content, key: badKey, contentType: 'application/fhir+json' })
    ).rejects.toThrow(/JWE encryption failed/)
  })

  it('generates unique IVs for each encryption operation (SHL spec compliance)', async () => {
    const key = generateB64uKey()
    const content = JSON.stringify({ message: 'Same content every time' })
    const contentType = 'application/fhir+json' as const

    // Encrypt the same content multiple times with the same key
    const jweResults = []
    for (let i = 0; i < 10; i++) {
      const jwe = await encryptSHLFile({ content, key, contentType })
      jweResults.push(jwe)
    }

    // All JWE strings should be different due to unique IVs
    const uniqueJWEs = new Set(jweResults)
    expect(uniqueJWEs.size).toBe(jweResults.length)

    // Extract and verify IVs are unique (3rd component of JWE Compact format)
    const ivs = jweResults.map(jwe => jwe.split('.')[2])
    const uniqueIVs = new Set(ivs)
    expect(uniqueIVs.size).toBe(ivs.length)

    // Verify all results can be decrypted to the same content
    for (const jwe of jweResults) {
      const { content: decrypted, contentType: cty } = await decryptSHLFile({ jwe, key })
      expect(decrypted).toBe(content)
      expect(cty).toBe(contentType)
    }
  })
})
