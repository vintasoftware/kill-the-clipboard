import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Directory } from '../../src/shc/directory'
import type { DirectoryJSON } from '../../src/shc/types'

describe('Directory', () => {
  const ISS_URL = 'https://example.com/issuer'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // suppress console output during tests
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  })

  it('should create a directory from JSON', () => {
    const directoryJson = {
      directory: 'https://example.com/keystore/directory.json',
      issuerInfo: [
        {
          issuer: {
            iss: 'https://example.com/issuer',
            name: 'Example Issuer 1',
          },
          keys: [
            {
              kty: 'EC',
              kid: 'kid-1-simple',
            },
            {
              kty: 'EC',
              kid: 'kid-2-simple',
            },
          ],
          crls: [
            {
              kid: 'kid-2-simple',
              method: 'rid',
              ctr: 1,
              rids: ['revoked-1'],
            },
          ],
        },
        {
          issuer: {
            iss: 'https://example.com/issuer2',
            name: 'Example Issuer 2',
          },
          keys: [
            {
              kty: 'EC',
              kid: 'kid-A-simple',
            },
          ],
        },
        {
          issuer: {
            iss: 'https://example.com/issuer3',
            name: 'Example Issuer 3',
          },
          keys: [
            {
              kty: 'EC',
              kid: 'kid-C-simple',
            },
          ],
        },
        {
          issuer: {
            iss: 'https://example.com/issuer4',
            name: 'Example Issuer 4',
            website: 'https://example.com/issuer4',
          },
          keys: [
            {
              kty: 'EC',
              kid: 'kid-D-simple',
            },
          ],
          crls: [
            {
              kid: 'kid-D-simple',
              method: 'rid',
              ctr: 1,
              rids: ['revoked-2'],
            },
          ],
        },
      ],
    }
    const directory = Directory.fromJSON(directoryJson as DirectoryJSON)
    const issuers = directory.getIssuerInfo()
    expect(issuers).toHaveLength(4)

    const issuer1 = issuers[0]!
    expect(issuer1.iss).toEqual('https://example.com/issuer')
    expect(issuer1.keys).toHaveLength(2)
    const crls1 = issuer1.crls!
    expect(crls1).toHaveLength(1)
    expect(crls1[0]!.kid).toEqual('kid-2-simple')

    const issuer2 = issuers.find(i => i.iss === 'https://example.com/issuer2')!
    expect(issuer2).toBeDefined()
    expect(issuer2.keys).toHaveLength(1)

    const issuer3 = issuers.find(i => i.iss === 'https://example.com/issuer3')!
    expect(issuer3).toBeDefined()
    expect(issuer3.keys).toHaveLength(1)

    const issuer4 = issuers.find(i => i.iss === 'https://example.com/issuer4')!
    expect(issuer4).toBeDefined()
    expect(issuer4.keys).toHaveLength(1)
    const crls4 = issuer4.crls!
    expect(crls4).toHaveLength(1)
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

      return Promise.resolve({ ok: false, status: 404 })
    })
    ;(globalThis as any).fetch = fetchMock

    const directory = await Directory.fromURLs([ISS_URL])
    const issuers = directory.getIssuerInfo()
    expect(issuers).toHaveLength(1)
    const issuer = issuers[0]!
    expect(issuer.iss).toEqual(ISS_URL)
    // Only one CRL should be collected (kid1 failed)
    expect(issuer.crls).toHaveLength(1)
    expect(issuer.crls![0]!.kid).toEqual('kid2')
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
        })
      }

      return Promise.resolve({ ok: false, status: 404 })
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
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    ;(globalThis as any).fetch = fetchMock

    const directory = await Directory.fromURLs([ISS_URL])
    const issuers = directory.getIssuerInfo()
    expect(issuers).toHaveLength(0)

    ;(globalThis as any).fetch = originalFetch
  })
})
