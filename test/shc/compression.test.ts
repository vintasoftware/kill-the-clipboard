import { beforeEach, describe, expect, it } from 'vitest'
import { type FHIRBundle, SHCIssuer, SHCReader } from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('Compression Features', () => {
  let issuer: SHCIssuer
  let reader: SHCReader
  let validBundle: FHIRBundle

  beforeEach(() => {
    validBundle = createValidFHIRBundle()
    issuer = new SHCIssuer({
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: false,
      strictReferences: true,
    })
    reader = new SHCReader({
      publicKey: testPublicKeySPKI,
      enableQROptimization: false,
      strictReferences: true,
    })
  })

  it('should create compressed SMART Health Card', async () => {
    const healthCard = await issuer.issue(validBundle)
    const jws = healthCard.asJWS()

    expect(jws).toBeDefined()
    expect(typeof jws).toBe('string')
    const parts = jws.split('.')
    expect(parts).toHaveLength(3)

    const { decodeProtectedHeader } = await import('jose')
    const header = decodeProtectedHeader(jws)
    expect(header.zip).toBe('DEF')
  })

  it('should verify compressed SMART Health Card', async () => {
    const healthCard = await issuer.issue(validBundle)
    const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
    const verifiedBundle = await verifiedHealthCard.asBundle()

    expect(verifiedBundle).toBeDefined()
    expect(verifiedBundle).toEqual(validBundle)
  })

  it('should handle round-trip compression and decompression', async () => {
    const healthCard = await issuer.issue(validBundle)
    const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
    const verifiedBundle = await verifiedHealthCard.asBundle()
    expect(verifiedBundle).toEqual(validBundle)
  })
})
