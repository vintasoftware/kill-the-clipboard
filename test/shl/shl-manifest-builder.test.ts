import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHL, SHLManifestBuilder, SmartHealthCardIssuer } from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('SHLManifestBuilder', () => {
  let shl: SHL
  let uploadedFiles: Map<string, string>
  let manifestBuilder: SHLManifestBuilder

  beforeEach(() => {
    shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org/manifests/',
      manifestPath: '/manifest.json',
    })
    uploadedFiles = new Map()
    manifestBuilder = new SHLManifestBuilder({
      shl,
      uploadFile: async (content: string) => {
        const fileId = `file-${uploadedFiles.size + 1}`
        uploadedFiles.set(fileId, content)
        return fileId
      },
      getFileURL: (path: string) => `https://files.example.org/${path}`,
      loadFile: async (path: string) => {
        const content = uploadedFiles.get(path)
        if (!content) throw new Error(`File not found: ${path}`)
        return content
      },
    })
  })

  it('should add SMART Health Cards to manifest', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    await manifestBuilder.addHealthCard({ shc: healthCard })

    expect(manifestBuilder.files).toHaveLength(1)
    expect(manifestBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(manifestBuilder.files[0]?.storagePath).toMatch(/^file-\d+$/)
    expect(manifestBuilder.files[0]?.ciphertextLength).toBeGreaterThan(0)
  })

  it('should add FHIR resources to manifest', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    expect(manifestBuilder.files).toHaveLength(1)
    expect(manifestBuilder.files[0]?.type).toBe('application/fhir+json')
    expect(manifestBuilder.files[0]?.storagePath).toMatch(/^file-\d+$/)
    expect(manifestBuilder.files[0]?.ciphertextLength).toBeGreaterThan(0)
  })

  it('should build manifest with embedded files for small content', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax: 50000 })

    expect(manifest.files).toHaveLength(1)
    const firstFile = manifest.files[0]
    expect(firstFile).toBeDefined()
    expect('embedded' in firstFile).toBe(true)
    expect('location' in firstFile).toBe(false)
  })

  it('should build manifest with location files for large content', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax: 100 })

    expect(manifest.files).toHaveLength(1)
    const firstFile = manifest.files[0]
    expect(firstFile).toBeDefined()
    expect('location' in firstFile).toBe(true)
    expect('embedded' in firstFile).toBe(false)

    if ('location' in firstFile) {
      expect(firstFile.location).toMatch(/^https:\/\/files\.example\.org\/file-\d+$/)
    }
  })

  it('should use default loadFile implementation when not provided', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      const fileId = url.split('/').pop()
      if (!fileId)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      const content = uploadedFiles.get(fileId)
      if (!content)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      return { ok: true, status: 200, statusText: 'OK', text: async () => content } as Response
    })

    const builderWithoutLoadFile = new SHLManifestBuilder({
      shl,
      uploadFile: async (content: string) => {
        const fileId = `file-${uploadedFiles.size + 1}`
        uploadedFiles.set(fileId, content)
        return fileId
      },
      getFileURL: (path: string) => `https://files.example.org/${path}`,
      fetch: mockFetch,
    })

    await builderWithoutLoadFile.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await builderWithoutLoadFile.buildManifest({ embeddedLengthMax: 50000 })

    expect(manifest.files).toHaveLength(1)
    const firstFile = manifest.files[0]
    expect(firstFile).toBeDefined()
    expect('embedded' in firstFile).toBe(true)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('should handle loadFile errors gracefully in default implementation', async () => {
    const mockFetch = vi.fn(
      async () =>
        ({ ok: false, status: 404, statusText: 'Not Found', text: async () => '' }) as Response
    )

    const builderWithFailingLoadFile = new SHLManifestBuilder({
      shl,
      uploadFile: async (content: string) => {
        const fileId = `file-${uploadedFiles.size + 1}`
        uploadedFiles.set(fileId, content)
        return fileId
      },
      getFileURL: (path: string) => `https://files.example.org/${path}`,
      fetch: mockFetch,
    })

    await builderWithFailingLoadFile.addFHIRResource({ content: createValidFHIRBundle() })
    await expect(
      builderWithFailingLoadFile.buildManifest({ embeddedLengthMax: 50000 })
    ).rejects.toThrow('File not found at storage path')
  })

  it('should serialize and deserialize builder state correctly', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    const fhirResource = createValidFHIRBundle()

    await manifestBuilder.addHealthCard({ shc: healthCard })
    await manifestBuilder.addFHIRResource({ content: fhirResource })

    const serialized = manifestBuilder.serialize()
    expect(serialized.shl).toBeDefined()
    expect(serialized.files).toHaveLength(2)
    expect(serialized.files[0]?.type).toBe('application/smart-health-card')
    expect(serialized.files[1]?.type).toBe('application/fhir+json')

    const deserializedBuilder = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async (content: string) => {
        const fileId = `file-${uploadedFiles.size + 1}`
        uploadedFiles.set(fileId, content)
        return fileId
      },
      getFileURL: (path: string) => `https://files.example.org/${path}`,
      loadFile: async (path: string) => {
        const content = uploadedFiles.get(path)
        if (!content) throw new Error(`File not found: ${path}`)
        return content
      },
    })

    expect(deserializedBuilder.files).toHaveLength(2)
    expect(deserializedBuilder.shl.url).toBe(shl.url)
    expect(deserializedBuilder.shl.key).toBe(shl.key)
    expect(deserializedBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(deserializedBuilder.files[1]?.type).toBe('application/fhir+json')
  })

  it('should build fresh manifests with short-lived URLs on each request', async () => {
    let urlCounter = 0
    const builderWithDynamicUrls = new SHLManifestBuilder({
      shl,
      uploadFile: async (content: string) => {
        const fileId = `file-${uploadedFiles.size + 1}`
        uploadedFiles.set(fileId, content)
        return fileId
      },
      getFileURL: (path: string) => `https://files.example.org/${path}?token=${++urlCounter}`,
      loadFile: async (path: string) => {
        const content = uploadedFiles.get(path)
        if (!content) throw new Error(`File not found: ${path}`)
        return content
      },
    })

    await builderWithDynamicUrls.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest1 = await builderWithDynamicUrls.buildManifest({ embeddedLengthMax: 100 })
    const manifest2 = await builderWithDynamicUrls.buildManifest({ embeddedLengthMax: 100 })

    expect(manifest1.files).toHaveLength(1)
    expect(manifest2.files).toHaveLength(1)

    const file1 = manifest1.files[0]
    const file2 = manifest2.files[0]
    if (file1 && file2 && 'location' in file1 && 'location' in file2) {
      expect(file1.location).toContain('token=1')
      expect(file2.location).toContain('token=2')
      expect(file1.location).not.toBe(file2.location)
    }
  })

  it('should handle different embeddedLengthMax values per request', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const manifestEmbedded = await manifestBuilder.buildManifest({ embeddedLengthMax: 50000 })
    const embeddedFile = manifestEmbedded.files[0]
    expect(embeddedFile).toBeDefined()
    expect('embedded' in embeddedFile).toBe(true)

    const manifestLocation = await manifestBuilder.buildManifest({ embeddedLengthMax: 100 })
    const locationFile = manifestLocation.files[0]
    expect(locationFile).toBeDefined()
    expect('location' in locationFile).toBe(true)
  })

  it('should handle compression options for different file types', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    const fhirResource = createValidFHIRBundle()

    await manifestBuilder.addHealthCard({ shc: healthCard, enableCompression: true })
    await manifestBuilder.addFHIRResource({ content: fhirResource, enableCompression: false })

    expect(manifestBuilder.files).toHaveLength(2)
    expect(manifestBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(manifestBuilder.files[1]?.type).toBe('application/fhir+json')
  })

  it('should handle string JWS input for addHealthCard', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    const jwsString = healthCard.asJWS()

    await manifestBuilder.addHealthCard({ shc: jwsString })
    expect(manifestBuilder.files).toHaveLength(1)
    expect(manifestBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(manifestBuilder.files[0]?.storagePath).toMatch(/^file-\d+$/)
  })

  it('should properly encrypt and store file metadata', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const fileMetadata = manifestBuilder.files[0]
    expect(fileMetadata).toBeDefined()
    expect(fileMetadata?.type).toBe('application/fhir+json')
    expect(fileMetadata?.storagePath).toMatch(/^file-\d+$/)
    expect(fileMetadata?.ciphertextLength).toBeGreaterThan(0)

    const uploadedContent = uploadedFiles.get(fileMetadata?.storagePath || '')
    expect(uploadedContent).toBeDefined()
    expect(uploadedContent).toMatch(/^eyJ[A-Za-z0-9_-]+\..+/)
  })

  it('should provide manifest ID from SHL URL', () => {
    const manifestId = manifestBuilder.manifestId

    // The manifest ID should be a 43-character base64url string
    expect(manifestId).toHaveLength(43)
    expect(manifestId).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // The manifest ID should be part of the SHL's manifest URL
    expect(shl.url).toContain(manifestId)

    // The manifest ID should be the entropy segment in the URL path
    const url = new URL(shl.url)
    const pathSegments = url.pathname.split('/').filter(segment => segment.length > 0)
    const expectedEntropySegment = pathSegments[pathSegments.length - 2]
    expect(manifestId).toBe(expectedEntropySegment)
  })

  it('should handle builder deserialization without optional parameters', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    await manifestBuilder.addHealthCard({ shc: healthCard })

    const serialized = manifestBuilder.serialize()
    const mockFetch = vi.fn(async (url: string) => {
      const fileId = url.split('/').pop()
      if (!fileId)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      const content = uploadedFiles.get(fileId)
      if (!content)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      return { ok: true, status: 200, statusText: 'OK', text: async () => content } as Response
    })

    const deserializedBuilder = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async () => 'new-file',
      getFileURL: (path: string) => `https://example.org/${path}`,
      fetch: mockFetch,
    })

    expect(deserializedBuilder.files).toHaveLength(1)
    expect(deserializedBuilder.shl.url).toBe(shl.url)
  })

  it('sets zip=DEF when compression enabled and omits otherwise', async () => {
    await manifestBuilder.addFHIRResource({
      content: createValidFHIRBundle(),
      enableCompression: true,
    })
    await manifestBuilder.addFHIRResource({
      content: createValidFHIRBundle(),
      enableCompression: false,
    })

    const jwes = Array.from(uploadedFiles.values())
    expect(jwes.length).toBe(2)

    const headers = [] as Array<Record<string, unknown>>
    for (const jwe of jwes) {
      const [protectedHeaderB64u] = jwe.split('.')
      const { base64url } = await import('jose')
      const bytes = base64url.decode(protectedHeaderB64u)
      const json = new TextDecoder().decode(bytes)
      headers.push(JSON.parse(json) as Record<string, unknown>)
    }

    const hasZip = headers.some(h => h.zip === 'DEF')
    const hasNoZip = headers.some(h => !('zip' in h))
    expect(hasZip).toBe(true)
    expect(hasNoZip).toBe(true)
  })

  it('manifestId throws on malformed manifest URL', () => {
    // Construct SHL then force an invalid internal URL via serialize/deserialize hack
    const good = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      manifestPath: '/manifest.json',
    })
    const uploaded = new Map<string, string>()
    const builder = new SHLManifestBuilder({
      shl: good,
      uploadFile: async (c: string) => {
        const id = `f-${uploaded.size + 1}`
        uploaded.set(id, c)
        return id
      },
      getFileURL: async (p: string) => `https://files/${p}`,
      loadFile: async (p: string) => uploaded.get(p) as string,
    })

    const serialized = builder.serialize()
    // Corrupt the url path: remove entropy segment
    serialized.shl.url = 'https://shl.example.org/manifest.json'
    const corrupted = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async (c: string) => 'x',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow('Invalid manifest URL format')
  })

  it('default loadFile maps 429 to SHLManifestRateLimitError and 500 to SHLNetworkError', async () => {
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      manifestPath: '/manifest.json',
    })
    const uploaded = new Map<string, string>()

    const fetch429 = vi.fn(
      async () =>
        ({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => '',
        }) as Response
    )
    const builder429 = new SHLManifestBuilder({
      shl,
      uploadFile: async (c: string) => {
        const id = `f-${uploaded.size + 1}`
        uploaded.set(id, c)
        return id
      },
      getFileURL: async (p: string) => `https://files/${p}`,
      fetch: fetch429,
    })

    await builder429.addFHIRResource({
      content: { resourceType: 'Patient' } as any,
      enableCompression: false,
    })
    await expect(builder429.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'Too many requests to file storage'
    )

    const fetch500 = vi.fn(
      async () =>
        ({ ok: false, status: 500, statusText: 'Internal Error', text: async () => '' }) as Response
    )
    const builder500 = new SHLManifestBuilder({
      shl,
      uploadFile: async (c: string) => 'id',
      getFileURL: async (p: string) => `https://files/${p}`,
      fetch: fetch500,
    })

    await builder500.addFHIRResource({
      content: { resourceType: 'Patient' } as any,
      enableCompression: false,
    })
    await expect(builder500.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'HTTP 500: Internal Error'
    )
  })
})
