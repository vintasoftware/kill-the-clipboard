import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decryptSHLFile,
  SHL,
  SHLManifestBuilder,
  SHLNetworkError,
  SmartHealthCardIssuer,
} from '@/index'
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
      getFileURL: async (path: string) => `https://files.example.org/${path}`,
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
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const fileMetadata = manifestBuilder.files[0]!
    expect(fileMetadata.type).toBe('application/smart-health-card')
    expect(fileMetadata.storagePath).toMatch(/^file-\d+$/)
    expect(fileMetadata.ciphertextLength).toBeGreaterThan(0)

    // Decrypt and verify content
    const jwe = uploadedFiles.get(fileMetadata.storagePath)
    expect(jwe).toBeDefined()
    const { content: decryptedJson } = await decryptSHLFile({
      // biome-ignore lint/style/noNonNullAssertion: jwe is checked for definedness above
      jwe: jwe!,
      key: shl.key,
    })
    const decryptedFile = JSON.parse(decryptedJson)
    expect(decryptedFile.verifiableCredential).toEqual([healthCard.asJWS()])
  })

  it('should add FHIR resources to manifest', async () => {
    const fhirBundle = createValidFHIRBundle()
    await manifestBuilder.addFHIRResource({ content: fhirBundle })
    expect(manifestBuilder.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const fileMetadata = manifestBuilder.files[0]!
    expect(fileMetadata.type).toBe('application/fhir+json')
    expect(fileMetadata.storagePath).toMatch(/^file-\d+$/)
    expect(fileMetadata.ciphertextLength).toBeGreaterThan(0)

    // Decrypt and verify content
    const jwe = uploadedFiles.get(fileMetadata.storagePath)
    expect(jwe).toBeDefined()
    const { content: decryptedJson } = await decryptSHLFile({
      // biome-ignore lint/style/noNonNullAssertion: jwe is checked for definedness above
      jwe: jwe!,
      key: shl.key,
    })
    const decryptedResource = JSON.parse(decryptedJson)
    expect(decryptedResource).toEqual(fhirBundle)
  })

  it('should build manifest with embedded files for small content', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax: 50000 })

    expect(manifest.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length   already asserted to == 1
    const firstFile = manifest.files[0]!
    expect(firstFile).toBeDefined()
    expect('embedded' in firstFile).toBe(true)
    expect('location' in firstFile).toBe(false)
  })

  it('should build manifest with location files for large content', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax: 100 })

    expect(manifest.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const firstFile = manifest.files[0]!
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
      getFileURL: async (path: string) => `https://files.example.org/${path}`,
      fetch: mockFetch,
    })

    await builderWithoutLoadFile.addFHIRResource({ content: createValidFHIRBundle() })
    const manifest = await builderWithoutLoadFile.buildManifest({ embeddedLengthMax: 50000 })

    expect(manifest.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const firstFile = manifest.files[0]!
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
      uploadFile: async (_content: string) => 'id',
      getFileURL: async (path: string) => `https://files.example.org/${path}`,
      fetch: mockFetch,
    })

    await builderWithFailingLoadFile.addFHIRResource({ content: createValidFHIRBundle() })
    await expect(
      builderWithFailingLoadFile.buildManifest({ embeddedLengthMax: 50000 })
    ).rejects.toThrow(SHLNetworkError)
    await expect(
      builderWithFailingLoadFile.buildManifest({ embeddedLengthMax: 50000 })
    ).rejects.toThrow('File not found at URL: https://files.example.org/id')
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
      getFileURL: async (path: string) => `https://files.example.org/${path}`,
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
      getFileURL: async (path: string) => `https://files.example.org/${path}?token=${++urlCounter}`,
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

    expect(manifestEmbedded.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const embeddedFile = manifestEmbedded.files[0]!
    expect(embeddedFile).toBeDefined()
    expect('embedded' in embeddedFile).toBe(true)

    const manifestLocation = await manifestBuilder.buildManifest({ embeddedLengthMax: 100 })

    expect(manifestLocation.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const locationFile = manifestLocation.files[0]!
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
    const pathSegments = url.pathname.split('/')
    const expectedEntropySegment = pathSegments[pathSegments.length - 2]
    expect(manifestId).toBe(expectedEntropySegment)
  })

  it('should handle manifest URL without manifestPath', () => {
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
    })
    const builder = new SHLManifestBuilder({
      shl,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => `https://files/${p}`,
      loadFile: async (_p: string) => 'x',
    })

    const manifestId = builder.manifestId

    // The manifest ID should be part of the SHL's manifest URL
    expect(shl.url).toContain(manifestId)

    // The manifest ID should be the entropy segment in the URL path
    const url = new URL(shl.url)
    const pathSegments = url.pathname.split('/')
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
      getFileURL: async (path: string) => `https://example.org/${path}`,
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
      const [protectedHeaderB64u] = jwe.split('.') as [string, ...string[]]
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
      uploadFile: async (_c: string) => 'x',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow(
      'Could not find entropy segment in path: /manifest.json'
    )
  })

  it('default loadFile maps 429 and 500 to SHLNetworkError', async () => {
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      manifestPath: '/manifest.json',
    })

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
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => `https://files/${p}`,
      fetch: fetch429,
    })

    await builder429.addFHIRResource({
      content: { resourceType: 'Patient' },
      enableCompression: false,
    })
    await expect(builder429.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      SHLNetworkError
    )
    await expect(builder429.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'Failed to fetch file from storage at https://files/id, got HTTP 429: Too Many Requests'
    )

    const fetch500 = vi.fn(
      async () =>
        ({ ok: false, status: 500, statusText: 'Internal Error', text: async () => '' }) as Response
    )
    const builder500 = new SHLManifestBuilder({
      shl,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => `https://files/${p}`,
      fetch: fetch500,
    })

    await builder500.addFHIRResource({
      content: { resourceType: 'Patient' },
      enableCompression: false,
    })
    await expect(builder500.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      SHLNetworkError
    )
    await expect(builder500.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'Failed to fetch file from storage at https://files/id, got HTTP 500: Internal Error'
    )
  })

  it('manifestId throws when entropy segment is empty between slashes', () => {
    const serialized = manifestBuilder.serialize()
    // Create a URL with an empty segment between slashes
    serialized.shl.url = 'https://shl.example.org/abc//manifest.json'
    const corrupted = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow(
      'Could not find entropy segment in path: /abc//manifest.json'
    )
  })

  it('manifestId throws on invalid entropy length', () => {
    // Build a valid builder, then corrupt URL to have a short entropy segment
    const serialized = manifestBuilder.serialize()
    serialized.shl.url = 'https://shl.example.org/short/manifest.json'
    const corrupted = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow('Invalid entropy segment length: expected 43, got 5')
  })

  it('manifestId throws on invalid entropy format characters', () => {
    const invalid = '!'.repeat(43)
    const serialized = manifestBuilder.serialize()
    serialized.shl.url = `https://shl.example.org/${invalid}/manifest.json`
    const corrupted = SHLManifestBuilder.deserialize({
      data: serialized,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow(`Invalid entropy segment format: ${invalid}`)
  })

  it('buildManifest wraps non-SHL errors into SHLManifestError', async () => {
    const uploaded = new Map<string, string>()
    const builder = new SHLManifestBuilder({
      shl,
      uploadFile: async (content: string) => {
        const id = `file-${uploaded.size + 1}`
        uploaded.set(id, content)
        return id
      },
      getFileURL: async (p: string) => `https://files.example.org/${p}`,
      loadFile: async () => {
        throw new Error('boom')
      },
    })

    await builder.addFHIRResource({ content: createValidFHIRBundle() })
    await expect(builder.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'Failed to build manifest: boom'
    )
  })
})
