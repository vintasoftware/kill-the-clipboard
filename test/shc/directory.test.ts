import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Directory } from '../../src/shc/directory'

describe('Directory', () => {
  const ISS_URL = 'https://example.com/issuer'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // suppress console output during tests
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  })

  it('should create a directory from a list of issuer urls and fetch jwks and crls', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `${ISS_URL}/.well-known/jwks.json`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            keys: [
              {
                kid: 'kid1',
                kty: 'EC',
              },
              {
                kid: 'kid2',
                kty: 'EC',
              },
            ],
          }),
        })
      }

      if (url === `${ISS_URL}/.well-known/crl/kid2.json`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            kid: 'kid2',
            method: 'rid',
            ctr: 1,
            rids: ['imrevoked'],
          }),
        })
      }

      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    ;(globalThis as any).fetch = fetchMock

    const directory = await Directory.fromURLs([ISS_URL])
    const issuers = directory.getIssuerInfo()
    expect(issuers).toHaveLength(1)
    const issuer = issuers[0]!
    expect(issuer.iss).toBe(ISS_URL)
    // Only one CRL should be collected (kid1 failed)
    expect(issuer.crls).toHaveLength(1)
    expect(issuer.crls[0].kid).toEqual('kid2')
    // Both keys should be present
    expect(issuer.keys).toHaveLength(2)

    ;(globalThis as any).fetch = originalFetch
  })

  it('should handle jwks fetch failure gracefully and return empty directory', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `${ISS_URL}/.well-known/jwks.json`) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    ;(globalThis as any).fetch = fetchMock

    const directory = await Directory.fromURLs([ISS_URL])
    const issuers = directory.getIssuerInfo()
    expect(issuers).toHaveLength(0)

    ;(globalThis as any).fetch = originalFetch
  })
})
