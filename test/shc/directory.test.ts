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

  it('should create a directory from multiple issuer urls and fetch jwks and crls for each of them', async () => {
    const ISS_URL2 = 'https://example.org/issuer2'
    const ISS_URL3 = 'https://example.net/issuer3'
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      // issuer 1 jwks and crl
      if (url === `${ISS_URL}/.well-known/jwks.json`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            keys: [
              { kid: 'kid1', kty: 'EC' },
              { kid: 'kid2', kty: 'EC' },
            ],
          }),
        })
      }
      if (url === `${ISS_URL}/.well-known/crl/kid2.json`) {
        return Promise.resolve({ ok: true, json: async () => ({ kid: 'kid2' }) })
      }

      // issuer 2 jwks and crl
      if (url === `${ISS_URL2}/.well-known/jwks.json`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ keys: [{ kid: 'kidA', kty: 'EC' }] }),
        })
      }
      if (url === `${ISS_URL2}/.well-known/crl/kidA.json`) {
        return Promise.resolve({ ok: true, json: async () => ({ kid: 'kidA' }) })
      }

      // simulate jwks fetch failure for issuer3
      if (url === `${ISS_URL3}/.well-known/jwks.json`) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        })
      }

      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })
    ;(globalThis as any).fetch = fetchMock

    const directory = await Directory.fromURLs([ISS_URL, ISS_URL2, ISS_URL3])
    const issuers = directory.getIssuerInfo()
    // issuer3 jwks fetch will throw and be caught; only issuer1 and issuer2 should be present
    expect(issuers).toHaveLength(2)

    const issuer1 = issuers.find(i => i.iss === ISS_URL)!
    const issuer2 = issuers.find(i => i.iss === ISS_URL2)!
    const issuer3 = issuers.find(i => i.iss === ISS_URL3)

    expect(issuer1).toBeDefined()
    expect(issuer1.keys).toHaveLength(2)
    expect(issuer1.crls).toHaveLength(1)

    expect(issuer2).toBeDefined()
    expect(issuer2.keys).toHaveLength(1)
    expect(issuer2.crls).toHaveLength(1)

    // issuer3 should not be present due to JWKS fetch failure
    expect(issuer3).toBeUndefined()

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
