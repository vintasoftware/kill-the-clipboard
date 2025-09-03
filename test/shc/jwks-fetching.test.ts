// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to mock the fetch function
import { describe, expect, it, vi } from 'vitest'
import { SmartHealthCardIssuer, SmartHealthCardReader, VerificationError } from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('JWKS fetching for SmartHealthCardReader', () => {
  it('fetches issuer JWKS and verifies using matching kid when publicKey is omitted', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: false,
      strictReferences: true,
    })

    const healthCard = await issuer.issue(createValidFHIRBundle())
    const jws = healthCard.asJWS()

    const { importSPKI, exportJWK, calculateJwkThumbprint } = await import('jose')
    const keyObj = await importSPKI(testPublicKeySPKI, 'ES256')
    const jwk = await exportJWK(keyObj)
    const kid = await calculateJwkThumbprint(jwk)
    const jwks = { keys: [{ ...jwk, kid }] }

    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => jwks,
        }) as unknown as Response
    )
    ;(globalThis as any).fetch = fetchMock

    const reader = new SmartHealthCardReader({
      enableQROptimization: false,
      strictReferences: true,
    } as any)

    const verified = await reader.fromJWS(jws)
    const bundle = await verified.asBundle()
    expect(bundle.resourceType).toBe('Bundle')

    expect(fetchMock).toHaveBeenCalled()
    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string
    expect(calledUrl).toBe('https://example.com/.well-known/jwks.json')

    ;(globalThis as any).fetch = originalFetch
  })

  it('throws VerificationError when JWKS fetch fails', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: false,
      strictReferences: true,
    })

    const healthCard = await issuer.issue(createValidFHIRBundle())
    const jws = healthCard.asJWS()

    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({}),
        }) as unknown as Response
    )
    ;(globalThis as any).fetch = fetchMock

    const reader = new SmartHealthCardReader({
      enableQROptimization: false,
      strictReferences: true,
    } as any)

    await expect(reader.fromJWS(jws)).rejects.toThrow(VerificationError)

    ;(globalThis as any).fetch = originalFetch
  })
})
