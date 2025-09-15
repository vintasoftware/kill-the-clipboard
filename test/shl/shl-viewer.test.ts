import { base64url } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import {
  encryptSHLFile,
  SHL,
  SHLDecryptionError,
  SHLExpiredError,
  SHLFormatError,
  SHLInvalidContentError,
  SHLInvalidPasscodeError,
  SHLManifestBuilder,
  SHLManifestError,
  SHLManifestNotFoundError,
  SHLManifestRateLimitError,
  SHLNetworkError,
  SHLViewer,
  SHLViewerError,
  SmartHealthCardIssuer,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('SHLViewer', () => {
  describe('URI Parsing', () => {
    it('should parse valid SHLink URIs', () => {
      const originalSHL = SHL.generate({
        baseManifestURL: 'https://shl.example.org/manifests/',
        manifestPath: '/manifest.json',
        label: 'Original',
      })
      const uri = originalSHL.toURI()
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
      const uri = originalSHL.toURI()
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

    it('validates payload fields: key length, url, exp, flag', () => {
      const good = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const payload = { ...good.payload }

      // key length
      const p1 = { ...payload, key: payload.key.slice(0, 42) }
      const uri1 = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(p1)))}`
      expect(() => new SHLViewer({ shlinkURI: uri1 })).toThrow(SHLFormatError)
      expect(() => new SHLViewer({ shlinkURI: uri1 })).toThrow(
        'Invalid SHLink payload: "key" field must be 43 characters'
      )

      // bad url
      const p2 = { ...payload, url: 'not-a-url' }
      const uri2 = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(p2)))}`
      expect(() => new SHLViewer({ shlinkURI: uri2 })).toThrow(SHLFormatError)
      expect(() => new SHLViewer({ shlinkURI: uri2 })).toThrow(
        'Invalid SHLink payload: "url" field is not a valid URL'
      )

      // bad exp
      const p3 = { ...payload, exp: 0 }
      const uri3 = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(p3)))}`
      expect(() => new SHLViewer({ shlinkURI: uri3 })).toThrow(SHLFormatError)
      expect(() => new SHLViewer({ shlinkURI: uri3 })).toThrow(
        'Invalid SHLink payload: "exp" field must be a positive number'
      )

      // bad flag
      const p4 = { ...payload, flag: 'Z' as unknown as 'L' }
      const uri4 = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(p4)))}`
      expect(() => new SHLViewer({ shlinkURI: uri4 })).toThrow(SHLFormatError)
      expect(() => new SHLViewer({ shlinkURI: uri4 })).toThrow(
        'Invalid SHLink payload: "flag" not one of "L", "P", "LP", "U", "LU"'
      )
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

      const fhirBundle = createValidFHIRBundle()
      await builder.addFHIRResource({ content: fhirBundle })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1_000_000 })
      const shlinkURI = shl.toURI()

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
      expect(result.fhirResources).toHaveLength(1)
      expect(result.fhirResources[0]).toEqual(fhirBundle)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('resolves U-flag direct-file SHLinks (FHIR JSON)', async () => {
      // Create SHL and craft a U-flag payload pointing directly to a file URL
      const shl = SHL.generate({ baseManifestURL: 'https://files.example.org', label: 'Direct' })

      const fhirBundle = createValidFHIRBundle()
      const jwe = await encryptSHLFile({
        content: JSON.stringify(fhirBundle),
        key: shl.key,
        contentType: 'application/fhir+json',
      })

      // Build a payload with U flag
      const payload = { ...shl.payload, flag: 'U' as const, url: `${shl.url}` }
      const uri = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(payload)))}`
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url === payload.url) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => jwe,
          } as Response
        }
        // Any manifest POST should not be called for U flag
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const viewer = new SHLViewer({ shlinkURI: uri, fetch: fetchMock })
      const result = await viewer.resolveSHLink({ recipient: 'r' })
      expect(result.fhirResources).toHaveLength(1)
      expect(result.fhirResources[0]).toEqual(fhirBundle)
    })

    it('resolves U-flag direct-file SHLinks (SHC)', async () => {
      const shl = SHL.generate({
        baseManifestURL: 'https://files.example.org',
        label: 'Direct SHC',
      })
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const fhirBundle = createValidFHIRBundle()
      const healthCard = await issuer.issue(fhirBundle)
      const fileContent = JSON.stringify({ verifiableCredential: [healthCard.asJWS()] })
      const jwe = await encryptSHLFile({
        content: fileContent,
        key: shl.key,
        contentType: 'application/smart-health-card',
      })

      // Build a payload with U flag
      const payload = { ...shl.payload, flag: 'U' as const, url: `${shl.url}` }
      const uri = `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify(payload)))}`
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url === payload.url) {
          return { ok: true, status: 200, statusText: 'OK', text: async () => jwe } as Response
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      })

      const viewer = new SHLViewer({ shlinkURI: uri, fetch: fetchMock })
      const result = await viewer.resolveSHLink({
        recipient: 'r',
        shcReaderConfig: { publicKey: testPublicKeySPKI },
      })
      expect(result.smartHealthCards).toHaveLength(1)
      expect(result.fhirResources).toHaveLength(0)
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

      const fhirBundle = createValidFHIRBundle()
      await builder.addFHIRResource({ content: fhirBundle })
      const manifest = await builder.buildManifest({ embeddedLengthMax: 1 })
      const fileLocation =
        // biome-ignore lint/style/noNonNullAssertion: files available
        ('location' in manifest.files[0]! ? manifest.files[0]!.location : '') as string
      const ciphertext = uploaded.values().next().value as string

      const shlinkURI = shl.toURI()
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
      expect(result.fhirResources).toHaveLength(1)
      expect(result.fhirResources[0]).toEqual(fhirBundle)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('handles manifest HTTP errors and invalid JSON/validation', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shlinkURI = shl.toURI()

      const fetch401 = vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => '',
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch401 }).resolveSHLink({
          recipient: 'r',
          passcode: 'p',
        })
      ).rejects.toThrow(SHLInvalidPasscodeError)
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
      ).rejects.toThrow(SHLManifestNotFoundError)
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
      ).rejects.toThrow(SHLManifestRateLimitError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch429 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Too many requests to SHL manifest')

      const fetchInvalidJson = vi.fn(
        async () =>
          ({ ok: true, status: 200, statusText: 'OK', text: async () => 'not-json' }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchInvalidJson }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLManifestError)
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
      ).rejects.toThrow(SHLManifestError)
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

      const shlinkURI = shl.toURI()
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
      ).rejects.toThrow(SHLNetworkError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchFile404 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('File not found at URL: https://files.example.org/file-1')
    })

    it('throws SHLViewerError for recipient empty string', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shlinkURI = shl.toURI()

      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ files: [] }),
          }) as Response
      )

      const viewer = new SHLViewer({ shlinkURI, fetch: fetchMock })

      await expect(viewer.resolveSHLink({ recipient: '' })).rejects.toThrow(SHLViewerError)
      await expect(viewer.resolveSHLink({ recipient: '' })).rejects.toThrow(
        'Recipient must be a non-empty string'
      )
      await expect(viewer.resolveSHLink({ recipient: '   ' })).rejects.toThrow(SHLViewerError)
      await expect(viewer.resolveSHLink({ recipient: '   ' })).rejects.toThrow(
        'Recipient must be a non-empty string'
      )

      expect(fetchMock).not.toHaveBeenCalled()
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

      const v2 = new SHLViewer({ shlinkURI: shl.toURI(), fetch: fetchMock })
      await expect(v2.resolveSHLink({ recipient: 'r' })).rejects.toThrow(SHLDecryptionError)
      await expect(v2.resolveSHLink({ recipient: 'r' })).rejects.toThrow('JWE decryption failed')
    })

    it('throws SHLDecryptionError for key mismatch', async () => {
      const shl1 = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shl2WithWrongKey = SHL.generate({ baseManifestURL: 'https://shl.example.org' })

      const jwe = await encryptSHLFile({
        content: JSON.stringify(createValidFHIRBundle()),
        key: shl1.key,
        contentType: 'application/fhir+json',
      })
      const manifest = { files: [{ contentType: 'application/fhir+json', embedded: jwe }] }
      const shlinkURIWithWrongKey = shl2WithWrongKey.toURI()

      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          }) as Response
      )

      const viewer = new SHLViewer({ shlinkURI: shlinkURIWithWrongKey, fetch: fetchMock })
      await expect(viewer.resolveSHLink({ recipient: 'r' })).rejects.toThrow(SHLDecryptionError)
      await expect(viewer.resolveSHLink({ recipient: 'r' })).rejects.toThrow(
        'JWE decryption failed'
      )
    })

    it('throws SHLExpiredError when SHL is expired', async () => {
      const shl = SHL.generate({
        baseManifestURL: 'https://shl.example.org',
        expirationDate: new Date(Date.now() - 60_000),
      })
      const shlinkURI = shl.toURI()
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ files: [] }),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLExpiredError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws for content type mismatch between descriptor and decrypted file', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const jweMismatch = await encryptSHLFile({
        content: JSON.stringify({ resourceType: 'Patient' }),
        key: shl.key,
        contentType: 'application/fhir+json',
      })
      const manifest = {
        files: [{ contentType: 'application/smart-health-card', embedded: jweMismatch }],
      }
      const shlinkURI = shl.toURI()
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLManifestError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(/Content type mismatch/)
    })

    it('invalid SMART Health Card file: missing verifiableCredential array', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const jwe = await encryptSHLFile({
        content: JSON.stringify({}),
        key: shl.key,
        contentType: 'application/smart-health-card',
      })
      const manifest = { files: [{ contentType: 'application/smart-health-card', embedded: jwe }] }
      const shlinkURI = shl.toURI()
      const fetchMock = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLInvalidContentError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMock }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('missing verifiableCredential array')
    })

    it('invalid FHIR JSON file: not valid JSON and missing resourceType', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      // Not JSON case
      const jweNotJson = await encryptSHLFile({
        content: 'not-json',
        key: shl.key,
        contentType: 'application/fhir+json',
      })
      // Missing resourceType case
      const jweMissingType = await encryptSHLFile({
        content: JSON.stringify({ foo: 'bar' }),
        key: shl.key,
        contentType: 'application/fhir+json',
      })
      const manifest1 = { files: [{ contentType: 'application/fhir+json', embedded: jweNotJson }] }
      const manifest2 = {
        files: [{ contentType: 'application/fhir+json', embedded: jweMissingType }],
      }
      const shlinkURI = shl.toURI()

      const fetchNotJson = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest1),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchNotJson }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLInvalidContentError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchNotJson }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Invalid JSON file: not valid JSON')

      const fetchMissingType = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest2),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMissingType }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLInvalidContentError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetchMissingType }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Invalid FHIR JSON file: missing resourceType')
    })

    it('validateManifest errors for both/none of embedded/location and invalid URL', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shlinkURI = shl.toURI()

      const both = {
        files: [{ contentType: 'application/fhir+json', embedded: 'x', location: 'https://x' }],
      }
      const neither = { files: [{ contentType: 'application/fhir+json' }] }
      const badUrl = { files: [{ contentType: 'application/fhir+json', location: 'not-a-url' }] }

      const f1 = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(both),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: f1 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLManifestError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: f1 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('cannot have both "embedded" and "location"')

      const f2 = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(neither),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: f2 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLManifestError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: f2 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('must have either "embedded" or "location"')

      const f3 = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(badUrl),
          }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: f3 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLManifestError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: f3 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('"location" is not a valid URL')
    })

    it('manifest HTTP 500 maps to SHLNetworkError', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const shlinkURI = shl.toURI()
      const fetch500 = vi.fn(
        async () =>
          ({ ok: false, status: 500, statusText: 'Internal Err', text: async () => '' }) as Response
      )
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch500 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLNetworkError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch500 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow('Failed to fetch SHL manifest, got HTTP 500: Internal Err')
    })

    it('file fetch maps 429 and 500 to SHLNetworkError', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
      const manifest = {
        files: [{ contentType: 'application/fhir+json', location: 'https://files.example.org/f' }],
      }
      const shlinkURI = shl.toURI()

      const fetch429 = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => '',
        } as Response
      })
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch429 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLNetworkError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch429 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(
        'Failed to fetch file from storage at https://files.example.org/f, got HTTP 429: Too Many Requests'
      )

      const fetch500 = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify(manifest),
          } as Response
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Error',
          text: async () => '',
        } as Response
      })
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch500 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(SHLNetworkError)
      await expect(
        new SHLViewer({ shlinkURI, fetch: fetch500 }).resolveSHLink({ recipient: 'r' })
      ).rejects.toThrow(
        'Failed to fetch file from storage at https://files.example.org/f, got HTTP 500: Internal Error'
      )
    })

    it('sends recipient, passcode, and embeddedLengthMax in manifest request body', async () => {
      const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'P' })
      const shlinkURI = shl.toURI()
      const calls: Array<RequestInit | undefined> = []
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(init)
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify({ files: [] }),
        } as Response
      })
      const viewer = new SHLViewer({ shlinkURI, fetch: fetchMock })
      await viewer.resolveSHLink({
        recipient: 'Dr. Who',
        passcode: 'secret',
        embeddedLengthMax: 4096,
      })
      expect(calls[0]?.method).toBe('POST')
      const body = JSON.parse((calls[0]?.body as string) ?? '{}') as Record<string, unknown>
      expect(body.recipient).toBe('Dr. Who')
      expect(body.passcode).toBe('secret')
      expect(body.embeddedLengthMax).toBe(4096)
    })
  })

  it('throws for missing payload in shlink URI', () => {
    expect(() => new SHLViewer({ shlinkURI: 'shlink:/' })).toThrow(SHLFormatError)
  })

  it('throws for unsupported version v in payload', () => {
    // Craft payload with v=2
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org' })
    const payload = { ...shl.payload, v: 2 as 1 }
    const json = JSON.stringify(payload)
    const { base64url } = require('jose') as typeof import('jose')
    const uri = `shlink:/${base64url.encode(new TextEncoder().encode(json))}`
    expect(() => new SHLViewer({ shlinkURI: uri })).toThrow(SHLFormatError)
    expect(() => new SHLViewer({ shlinkURI: uri })).toThrow('unsupported version')
  })

  it('enforces passcode when P flag is set', async () => {
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'P' })
    const shlinkURI = shl.toURI()
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
    await expect(
      new SHLViewer({ shlinkURI, fetch: fetchOkEmpty }).resolveSHLink({ recipient: 'r' })
    ).rejects.toThrow('SHL requires a passcode')
  })

  it('propagates 401 as SHLInvalidPasscodeError', async () => {
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'P' })
    const shlinkURI = shl.toURI()
    const fetch401 = vi.fn(
      async () =>
        ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' }) as Response
    )
    await expect(
      new SHLViewer({ shlinkURI, fetch: fetch401 }).resolveSHLink({
        recipient: 'r',
        passcode: 'x',
      })
    ).rejects.toThrow(SHLInvalidPasscodeError)
    await expect(
      new SHLViewer({ shlinkURI, fetch: fetch401 }).resolveSHLink({
        recipient: 'r',
        passcode: 'x',
      })
    ).rejects.toThrow('Invalid or missing passcode')
  })
})
