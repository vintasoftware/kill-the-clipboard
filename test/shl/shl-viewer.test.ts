import { base64url } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import {
  SHL,
  SHLFormatError,
  SHLInvalidPasscodeError,
  SHLManifestBuilder,
  SHLViewer,
} from '@/index'
import { createValidFHIRBundle } from '../helpers'

describe('SHLViewer', () => {
  describe('URI Parsing', () => {
    it('should parse valid SHLink URIs', () => {
      const originalSHL = SHL.generate({
        baseManifestURL: 'https://shl.example.org/manifests/',
        manifestPath: '/manifest.json',
        label: 'Original',
      })
      const uri = originalSHL.generateSHLinkURI()
      const viewer = new SHLViewer({ shlinkURI: uri })
      const parsedSHL = viewer.shl

      // ... assert URL
      expect(parsedSHL.label).toBe('Original')
      expect(parsedSHL.key).toBe(originalSHL.key)
    })

    it('should parse viewer-prefixed URIs', () => {
      const originalSHL = SHL.generate({
        baseManifestURL: 'https://shl.example.org',
        manifestPath: '/manifest.json',
        label: 'Test Card',
      })
      const uri = originalSHL.generateSHLinkURI()
      const viewerPrefixedURI = `https://viewer.example.com/#${uri}`

      const viewer = new SHLViewer({ shlinkURI: viewerPrefixedURI })
      const parsedSHL = viewer.shl

      expect(parsedSHL.url).toMatch(
        /^https:\/\/shl\.example\.org\/[A-Za-z0-9_-]{43}\/manifest\.json$/
      )
      expect(parsedSHL.label).toBe('Test Card')
    })

    it('should throw error for invalid URI format', () => {
      expect(() => new SHLViewer({ shlinkURI: 'invalid://uri' })).toThrow(SHLFormatError)
    })

    it('should throw error for malformed payload', () => {
      expect(() => new SHLViewer({ shlinkURI: 'shlink:/invalid-base64' })).toThrow(SHLFormatError)
    })
  })

  describe('resolveSHLink', () => {
    it('resolves embedded file manifests', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'Embedded' })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: false })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1000000 })
      const shlinkURI = shl.generateSHLinkURI()

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.smartHealthCards.length + result.fhirResources.length).toBe(1)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('resolves location file manifests', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'Location' })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: false })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1 })
      const fileLocation =
        // biome-ignore lint/style/noNonNullAssertion: files available
        ('location' in manifest.files[0]! ? manifest.files[0]!.location : '') as string
      const ciphertext = uploaded.values().next().value as string

      const shlinkURI = shl.generateSHLinkURI()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET' && url === fileLocation) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => ciphertext,
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.smartHealthCards.length + result.fhirResources.length).toBe(1)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('handles manifest HTTP errors and invalid JSON/validation', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shlinkURI = shl.generateSHLinkURI()

      const fetch401 = vi.fn(
        async () =>
          ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch401 }).resolveSHLink({
          recipient: 'r',
          passcode: 'p',
        })
      ).rejects.toThrow('Invalid or missing passcode')

      const fetch404 = vi.fn(
        async () =>
          ({ ok: false, status: 404, statusText: 'Not Found', text: async () => '' }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch404 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('SHL manifest not found')

      const fetch429 = vi.fn(
        async () =>
          ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: async () => '',
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch429 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Too many requests to SHL manifest')

      const fetchInvalidJson = vi.fn(
        async () =>
          ({ ok: true, status: 200, statusText: 'OK', text: async () => 'not-json' }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchInvalidJson }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Invalid manifest response: not valid JSON')

      const invalidManifest = { files: [{ contentType: 'application/unknown' }] }
      const fetchInvalidManifest = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(invalidManifest),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchInvalidManifest }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('unsupported content type')
    })

    it('file fetch errors propagate correctly', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploaded.size + 1}`
          uploaded.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      await builder.addFHIRResource({ content: createValidFHIRBundle() })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1 })
      const fileLocation =
        // biome-ignore lint/style/noNonNullAssertion: files available
        ('location' in manifest.files[0]! ? manifest.files[0]!.location : '') as string

      const shlinkURI = shl.generateSHLinkURI()
      const fetchFile404 = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET' && url === fileLocation) {
          return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: async () => '',
          } as Response
        }
        return { ok: false, status: 500, statusText: 'Err', text: async () => '' } as Response
      })

      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchFile404 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('SHL file not found')
    })

    it('throws SHLDecryptionError for invalid JWE ciphertext', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const manifest = {
        files: [{ contentType: 'application/fhir+json', location: 'https://files.example.org/f' }],
      }

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => 'not-a-valid-jwe',
          } as Response
        }
        return { ok: false, status: 500, statusText: 'Err', text: async () => '' } as Response
      })

      const v2 = new SHLViewer({ shlinkURI: shl.generateSHLinkURI(), fetch: fetchMock })
      await expect(v2.resolveSHLink({ recipient: 'r' })).rejects.toThrow('JWE decryption failed')
    })
  })

  describe('ZIP compression handling', () => {
    it('resolves files with compression enabled (embedded)', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'Compressed' })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      // Add FHIR resource with compression enabled
      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: true })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1000000 })
      const shlinkURI = shl.generateSHLinkURI()

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.fhirResources.length).toBe(1)
      expect(result.fhirResources[0]?.resourceType).toBe('Bundle')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('resolves files with compression enabled (location)', async () => {
      const shl = SHL.generate({
        baseManifestURL: 'https://shl.example.org',
        label: 'Compressed Location',
      })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      // Add FHIR resource with compression enabled, force location by setting small embeddedLengthMax
      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: true })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1 })
      const fileLocation =
        // biome-ignore lint/style/noNonNullAssertion: files available
        ('location' in manifest.files[0]! ? manifest.files[0]!.location : '') as string
      const ciphertext = uploaded.values().next().value as string

      const shlinkURI = shl.generateSHLinkURI()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET' && url === fileLocation) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => ciphertext,
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.fhirResources.length).toBe(1)
      expect(result.fhirResources[0]?.resourceType).toBe('Bundle')
      expect(fetchMock).toHaveBeenCalledTimes(2) // One for manifest, one for file
    })

    it('handles mixed compression (some compressed, some not)', async () => {
      const shl = SHL.generate({
        baseManifestURL: 'https://shl.example.org',
        label: 'Mixed Compression',
      })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      // Add one compressed and one uncompressed FHIR resource
      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: true })
      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: false })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1000000 })
      const shlinkURI = shl.generateSHLinkURI()

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.fhirResources.length).toBe(2)
      expect(result.fhirResources[0]?.resourceType).toBe('Bundle')
      expect(result.fhirResources[1]?.resourceType).toBe('Bundle')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('handles JWE with zip header correctly when jose library would fail', async () => {
      // This test specifically verifies the fix for the issue where jose library
      // doesn't support zip headers and would throw an error like:
      // "JWE "zip" (Compression Algorithm) Header Parameter is not supported."
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })

      const uploaded = new Map<string, string>()
      const builder = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const id = `file-${uploaded.size + 1}`
          uploaded.set(id, content)
          return id
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        loadFile: async (path: string) => uploaded.get(path) as string,
      })

      // Create a compressed file
      await builder.addFHIRResource({ content: createValidFHIRBundle(), enableCompression: true })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1 })
      const fileLocation =
        // biome-ignore lint/style/noNonNullAssertion: files available
        ('location' in manifest.files[0]! ? manifest.files[0]!.location : '') as string
      const compressedJWE = uploaded.values().next().value as string

      // Verify that the JWE actually has a zip header (this would cause jose to fail without our fix)
      const parts = compressedJWE.split('.')
      expect(parts).toHaveLength(5)
      const header = JSON.parse(new TextDecoder().decode(base64url.decode(parts[0] as string)))
      expect(header.zip).toBe('DEF')

      const shlinkURI = shl.generateSHLinkURI()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url === shl.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET' && url === fileLocation) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => compressedJWE,
          } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      // This should succeed with our ZIP header handling fix
      const result = await new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({
        recipient: 'did:example:alice',
      })
      expect(result.fhirResources.length).toBe(1)
      expect(result.fhirResources[0]?.resourceType).toBe('Bundle')
    })

    it('handles malformed JWE header gracefully during zip detection', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const manifest = {
        files: [
          { contentType: 'application/fhir+json', location: 'https://files.example.org/malformed' },
        ],
      }

      // Create a JWE with malformed header (not valid base64url in first part)
      const malformedJWE = 'not-base64url.eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..invalid.invalid'

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => malformedJWE,
          } as Response
        }
        return { ok: false, status: 500, statusText: 'Err', text: async () => '' } as Response
      })

      const viewer = new SHLViewer({ shlinkURI: shl.generateSHLinkURI(), fetch: fetchMock })
      // Should fail at JWE decryption, not at header parsing
      await expect(viewer.resolveSHLink({ recipient: 'r' })).rejects.toThrow(
        'JWE decryption failed'
      )
    })

    it('handles JWE with wrong number of parts during zip detection', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const manifest = {
        files: [
          {
            contentType: 'application/fhir+json',
            location: 'https://files.example.org/wrong-parts',
          },
        ],
      }

      // Create a JWE with wrong number of parts
      const wrongPartsJWE = 'part1.part2.part3' // Should have 5 parts

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => wrongPartsJWE,
          } as Response
        }
        return { ok: false, status: 500, statusText: 'Err', text: async () => '' } as Response
      })

      const viewer = new SHLViewer({ shlinkURI: shl.generateSHLinkURI(), fetch: fetchMock })
      // Should fail at JWE decryption, not at header parsing
      await expect(viewer.resolveSHLink({ recipient: 'r' })).rejects.toThrow(
        'JWE decryption failed'
      )
    })

    it('handles JWE with non-JSON header during zip detection', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const manifest = {
        files: [
          { contentType: 'application/fhir+json', location: 'https://files.example.org/non-json' },
        ],
      }

      // Create a JWE with valid base64url but non-JSON content in header
      const nonJsonHeader = base64url.encode(new TextEncoder().encode('not-json'))
      const nonJsonHeaderJWE = `${nonJsonHeader}.eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..invalid.invalid`

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => nonJsonHeaderJWE,
          } as Response
        }
        return { ok: false, status: 500, statusText: 'Err', text: async () => '' } as Response
      })

      const viewer = new SHLViewer({ shlinkURI: shl.generateSHLinkURI(), fetch: fetchMock })
      // Should fail at JWE decryption, not at header parsing
      await expect(viewer.resolveSHLink({ recipient: 'r' })).rejects.toThrow(
        'JWE decryption failed'
      )
    })
  })

  it('throws for missing payload in shlink URI', () => {
    expect(() => new SHLViewer({ shlinkURI: 'shlink:/' })).toThrow(SHLFormatError)
  })

  it('throws for unsupported version v in payload', () => {
    // Craft payload with v=2
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
    const payload = { ...shl['payload'], v: 2 as 1 }
    const json = JSON.stringify(payload)
    const { base64url } = require('jose') as typeof import('jose')
    const uri = `shlink:/${base64url.encode(new TextEncoder().encode(json))}`
    expect(() => new SHLViewer({ shlinkURI: uri })).toThrow('unsupported version')
  })

  it('enforces passcode when P flag is set', async () => {
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'P' })
    const shlinkURI = shl.generateSHLinkURI()
    const fetchOkEmpty = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ files: [] }),
        }) as Response
    )
    await expect(
      new SHLViewer({ shlinkURI, fetch: fetchOkEmpty }).resolveSHLink({ recipient: 'r' })
    ).rejects.toThrow(SHLInvalidPasscodeError)
  })

  it('propagates 401 as SHLInvalidPasscodeError', async () => {
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'P' })
    const shlinkURI = shl.generateSHLinkURI()
    const fetch401 = vi.fn(
      async () =>
        ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' }) as Response
    )
    await expect(
      new SHLViewer({ shlinkURI, fetch: fetch401 }).resolveSHLink({
        recipient: 'r',
        passcode: 'x',
      })
    ).rejects.toThrow('Invalid or missing passcode')
  })
})
