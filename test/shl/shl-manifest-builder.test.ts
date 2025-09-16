import type { List, Resource } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decryptSHLFile,
  SHL,
  SHLExpiredError,
  SHLManifestBuilder,
  SHLNetworkError,
  SmartHealthCardIssuer,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('SHLManifestBuilder', () => {
  let shl: SHL
  let uploadedFiles: Map<string, string>
  let manifestBuilder: SHLManifestBuilder
  let removedFiles: Set<string>

  beforeEach(() => {
    shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org/manifests/',
      manifestPath: '/manifest.json',
    })
    uploadedFiles = new Map()
    removedFiles = new Set()
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
      removeFile: async (path: string) => {
        if (!uploadedFiles.has(path)) {
          throw new Error(`File not found for removal: ${path}`)
        }
        uploadedFiles.delete(path)
        removedFiles.add(path)
      },
      updateFile: async (path: string, content: string) => {
        if (!uploadedFiles.has(path)) {
          throw new Error(`File not found for update: ${path}`)
        }
        uploadedFiles.set(path, content)
      },
    })
  })

  it('should add SMART Health Cards to manifest', async () => {
    const beforeTime = new Date()
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    await manifestBuilder.addHealthCard({ shc: healthCard })
    const afterTime = new Date()

    expect(manifestBuilder.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const fileMetadata = manifestBuilder.files[0]!
    expect(fileMetadata.type).toBe('application/smart-health-card')
    expect(fileMetadata.storagePath).toMatch(/^file-\d+$/)
    expect(fileMetadata.ciphertextLength).toBeGreaterThan(0)

    // Check lastUpdated is automatically set
    expect(fileMetadata.lastUpdated).toBeDefined()
    const lastUpdated = new Date(fileMetadata.lastUpdated as string)
    expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
    expect(lastUpdated.getTime()).toBeLessThanOrEqual(afterTime.getTime())

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
    const beforeTime = new Date()
    const fhirBundle = createValidFHIRBundle()
    await manifestBuilder.addFHIRResource({ content: fhirBundle })
    const afterTime = new Date()

    expect(manifestBuilder.files).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: files length already asserted to == 1
    const fileMetadata = manifestBuilder.files[0]!
    expect(fileMetadata.type).toBe('application/fhir+json')
    expect(fileMetadata.storagePath).toMatch(/^file-\d+$/)
    expect(fileMetadata.ciphertextLength).toBeGreaterThan(0)

    // Check lastUpdated is automatically set
    expect(fileMetadata.lastUpdated).toBeDefined()
    const lastUpdated = new Date(fileMetadata.lastUpdated as string)
    expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
    expect(lastUpdated.getTime()).toBeLessThanOrEqual(afterTime.getTime())

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
    } else {
      throw new Error('firstFile is not a location file')
    }
  })

  it('should build an empty manifest if no files are added', async () => {
    const manifest = await manifestBuilder.buildManifest()
    expect(manifest.files).toHaveLength(0)
  })

  it('should include status and list fields in manifest when provided', async () => {
    await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })

    const testList: List = {
      resourceType: 'List',
      status: 'current',
      mode: 'snapshot',
      title: 'Patient Summary',
    }

    const manifestWithFields = await manifestBuilder.buildManifest({
      status: 'can-change',
      list: testList,
    })

    expect(manifestWithFields.status).toBe('can-change')
    expect(manifestWithFields.list).toEqual(testList)

    // Test manifest without optional fields
    const manifestWithoutFields = await manifestBuilder.buildManifest()
    expect(manifestWithoutFields.status).toBeUndefined()
    expect(manifestWithoutFields.list).toBeUndefined()
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
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => '',
        }) as Response
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

  it('should persist and reconstruct builder state correctly', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    const fhirResource = createValidFHIRBundle()

    await manifestBuilder.addHealthCard({ shc: healthCard })
    await manifestBuilder.addFHIRResource({ content: fhirResource })

    const builderAttrs = manifestBuilder.toDBAttrs()
    expect(builderAttrs.files).toHaveLength(2)
    expect(builderAttrs.files[0]?.type).toBe('application/smart-health-card')
    expect(builderAttrs.files[1]?.type).toBe('application/fhir+json')

    const shlPayload = shl.payload
    const reconstructedBuilder = SHLManifestBuilder.fromDBAttrs({
      shl: shlPayload,
      attrs: builderAttrs,
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

    expect(reconstructedBuilder.files).toHaveLength(2)
    expect(reconstructedBuilder.shl.url).toBe(shl.url)
    expect(reconstructedBuilder.shl.key).toBe(shl.key)
    expect(reconstructedBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(reconstructedBuilder.files[1]?.type).toBe('application/fhir+json')
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

  it('should handle different file types', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    const fhirResource = createValidFHIRBundle()

    await manifestBuilder.addHealthCard({ shc: healthCard })
    await manifestBuilder.addFHIRResource({ content: fhirResource })

    expect(manifestBuilder.files).toHaveLength(2)
    expect(manifestBuilder.files[0]?.type).toBe('application/smart-health-card')
    expect(manifestBuilder.files[1]?.type).toBe('application/fhir+json')
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

  it('should handle builder reconstruction without optional parameters', async () => {
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(createValidFHIRBundle())
    await manifestBuilder.addHealthCard({ shc: healthCard })

    const builderAttrs = manifestBuilder.toDBAttrs()
    const mockFetch = vi.fn(async (url: string) => {
      const fileId = url.split('/').pop()
      if (!fileId)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      const content = uploadedFiles.get(fileId)
      if (!content)
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
      return { ok: true, status: 200, statusText: 'OK', text: async () => content } as Response
    })

    const reconstructedBuilder = SHLManifestBuilder.fromDBAttrs({
      shl: shl.payload,
      attrs: builderAttrs,
      uploadFile: async () => 'new-file',
      getFileURL: async (path: string) => `https://example.org/${path}`,
      fetch: mockFetch,
    })

    expect(reconstructedBuilder.files).toHaveLength(1)
    expect(reconstructedBuilder.shl.url).toBe(shl.url)
  })

  it('manifestId throws on malformed manifest URL', () => {
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

    const builderAttrs = builder.toDBAttrs()
    // Corrupt the url path: remove entropy segment
    const corruptedShlPayload = { ...good.payload, url: 'https://shl.example.org/manifest.json' }
    const corrupted = SHLManifestBuilder.fromDBAttrs({
      shl: corruptedShlPayload,
      attrs: builderAttrs,
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
    })
    await expect(builder500.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      SHLNetworkError
    )
    await expect(builder500.buildManifest({ embeddedLengthMax: 1_000_000 })).rejects.toThrow(
      'Failed to fetch file from storage at https://files/id, got HTTP 500: Internal Error'
    )
  })

  it('manifestId throws when entropy segment is empty between slashes', () => {
    const builderAttrs = manifestBuilder.toDBAttrs()
    // Create a URL with an empty segment between slashes
    const corruptedShlPayload = {
      ...shl.payload,
      url: 'https://shl.example.org/abc//manifest.json',
    }
    const corrupted = SHLManifestBuilder.fromDBAttrs({
      shl: corruptedShlPayload,
      attrs: builderAttrs,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow(
      'Could not find entropy segment in path: /abc//manifest.json'
    )
  })

  it('manifestId throws on invalid entropy length', () => {
    // Build a valid builder, then corrupt URL to have a short entropy segment
    const builderAttrs = manifestBuilder.toDBAttrs()
    const corruptedShlPayload = {
      ...shl.payload,
      url: 'https://shl.example.org/short/manifest.json',
    }
    const corrupted = SHLManifestBuilder.fromDBAttrs({
      shl: corruptedShlPayload,
      attrs: builderAttrs,
      uploadFile: async (_c: string) => 'id',
      getFileURL: async (p: string) => p,
    })

    expect(() => corrupted.manifestId).toThrow('Invalid entropy segment length: expected 43, got 5')
  })

  it('manifestId throws on invalid entropy format characters', () => {
    const invalid = '!'.repeat(43)
    const builderAttrs = manifestBuilder.toDBAttrs()
    const corruptedShlPayload = {
      ...shl.payload,
      url: `https://shl.example.org/${invalid}/manifest.json`,
    }
    const corrupted = SHLManifestBuilder.fromDBAttrs({
      shl: corruptedShlPayload,
      attrs: builderAttrs,
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

  describe('File Removal', () => {
    it('should remove FHIR resource files successfully', async () => {
      const fhirBundle = createValidFHIRBundle()
      const result = await manifestBuilder.addFHIRResource({ content: fhirBundle })
      const storagePath = result.storagePath

      expect(manifestBuilder.files).toHaveLength(1)
      expect(uploadedFiles.has(storagePath)).toBe(true)
      expect(removedFiles.has(storagePath)).toBe(false)

      await manifestBuilder.removeFile(storagePath)

      expect(manifestBuilder.files).toHaveLength(0)
      expect(uploadedFiles.has(storagePath)).toBe(false)
      expect(removedFiles.has(storagePath)).toBe(true)
    })

    it('should remove Smart Health Card files successfully', async () => {
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())
      const result = await manifestBuilder.addHealthCard({ shc: healthCard })
      const storagePath = result.storagePath

      expect(manifestBuilder.files).toHaveLength(1)
      expect(uploadedFiles.has(storagePath)).toBe(true)

      await manifestBuilder.removeFile(storagePath)

      expect(manifestBuilder.files).toHaveLength(0)
      expect(uploadedFiles.has(storagePath)).toBe(false)
      expect(removedFiles.has(storagePath)).toBe(true)
    })

    it('should throw error when removeFile function is not provided', async () => {
      const builderWithoutRemove = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploadedFiles.size + 1}`
          uploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
      })

      const result = await builderWithoutRemove.addFHIRResource({
        content: createValidFHIRBundle(),
      })

      await expect(builderWithoutRemove.removeFile(result.storagePath)).rejects.toThrow(
        'File removal is not supported. Provide a removeFile function in the constructor to enable file removal.'
      )
    })

    it('should throw error when file not found in manifest', async () => {
      await expect(manifestBuilder.removeFile('nonexistent-file')).rejects.toThrow(
        "File with storage path 'nonexistent-file' not found in manifest"
      )
    })

    it('should handle storage errors during file removal', async () => {
      const builderWithFailingRemove = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploadedFiles.size + 1}`
          uploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        removeFile: async () => {
          throw new Error('Storage removal failed')
        },
      })

      const result = await builderWithFailingRemove.addFHIRResource({
        content: createValidFHIRBundle(),
      })

      await expect(builderWithFailingRemove.removeFile(result.storagePath)).rejects.toThrow(
        'Failed to remove file from storage: Storage removal failed'
      )
    })
  })

  describe('FHIR Resource Updates', () => {
    it('should update FHIR resource files successfully', async () => {
      const originalBundle = createValidFHIRBundle()
      const result = await manifestBuilder.addFHIRResource({ content: originalBundle })
      const storagePath = result.storagePath
      const originalSize = result.ciphertextLength

      const updatedBundle = {
        ...originalBundle,
        entry: [
          ...(originalBundle.entry || []),
          {
            fullUrl: 'https://example.org/fhir/Patient/456',
            resource: {
              resourceType: 'Patient' as const,
              id: '456',
              name: [{ family: 'Updated', given: ['Patient'] }],
            },
          },
        ],
      }

      const beforeUpdate = new Date()
      await manifestBuilder.updateFHIRResource(storagePath, updatedBundle as Resource)
      const afterUpdate = new Date()

      expect(manifestBuilder.files).toHaveLength(1)
      const updatedFile = manifestBuilder.files[0]
      expect(updatedFile).toBeDefined()
      expect(updatedFile?.storagePath).toBe(storagePath)
      expect(updatedFile?.type).toBe('application/fhir+json')
      expect(updatedFile?.ciphertextLength).not.toBe(originalSize) // Size should change
      if (updatedFile?.lastUpdated) {
        const lastUpdated = new Date(updatedFile.lastUpdated).getTime()
        expect(lastUpdated).toBeGreaterThanOrEqual(beforeUpdate.getTime())
        expect(lastUpdated).toBeLessThanOrEqual(afterUpdate.getTime())
      } else {
        throw new Error('lastUpdated is not defined')
      }

      // Verify the content was actually updated
      const encryptedContent = uploadedFiles.get(storagePath)
      expect(encryptedContent).toBeDefined()
      const { content: decryptedJson } = await decryptSHLFile({
        jwe: encryptedContent as string,
        key: shl.key,
      })
      const decryptedBundle = JSON.parse(decryptedJson)
      expect(decryptedBundle).toEqual(updatedBundle)
    })

    it('should throw error when updateFile function is not provided', async () => {
      const builderWithoutUpdate = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploadedFiles.size + 1}`
          uploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
      })

      const result = await builderWithoutUpdate.addFHIRResource({
        content: createValidFHIRBundle(),
      })

      await expect(
        builderWithoutUpdate.updateFHIRResource(result.storagePath, createValidFHIRBundle())
      ).rejects.toThrow(
        'File updates are not supported. Provide an updateFile function in the constructor to enable file updates.'
      )
    })

    it('should throw error when file not found in manifest', async () => {
      await expect(
        manifestBuilder.updateFHIRResource('nonexistent-file', createValidFHIRBundle())
      ).rejects.toThrow("File with storage path 'nonexistent-file' not found in manifest")
    })

    it('should throw error when trying to update non-FHIR file', async () => {
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())
      const result = await manifestBuilder.addHealthCard({ shc: healthCard })

      await expect(
        manifestBuilder.updateFHIRResource(result.storagePath, createValidFHIRBundle())
      ).rejects.toThrow(
        `File at storage path '${result.storagePath}' is not a FHIR resource (type: application/smart-health-card)`
      )
    })

    it('should handle storage errors during FHIR resource update', async () => {
      const builderWithFailingUpdate = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploadedFiles.size + 1}`
          uploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        updateFile: async () => {
          throw new Error('Storage update failed')
        },
      })

      const result = await builderWithFailingUpdate.addFHIRResource({
        content: createValidFHIRBundle(),
      })

      await expect(
        builderWithFailingUpdate.updateFHIRResource(result.storagePath, createValidFHIRBundle())
      ).rejects.toThrow('Failed to update FHIR resource in storage: Storage update failed')
    })

    it('should handle compression options when updating FHIR resources', async () => {
      const originalBundle = createValidFHIRBundle()
      const result = await manifestBuilder.addFHIRResource({
        content: originalBundle,
        enableCompression: true,
      })

      const updatedBundle = { ...originalBundle, id: 'updated' }
      await manifestBuilder.updateFHIRResource(result.storagePath, updatedBundle, false)

      // Verify the file was updated and compression setting was applied
      const encryptedContent = uploadedFiles.get(result.storagePath)
      expect(encryptedContent).toBeDefined()
      const [protectedHeaderB64u] = (encryptedContent as string).split('.') as [string, ...string[]]
      const { base64url } = await import('jose')
      const bytes = base64url.decode(protectedHeaderB64u)
      const json = new TextDecoder().decode(bytes)
      const header = JSON.parse(json) as Record<string, unknown>

      // Should not have zip header when compression disabled
      expect('zip' in header).toBe(false)
    })
  })

  describe('Smart Health Card Updates', () => {
    it('should update Smart Health Card files successfully', async () => {
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })

      const originalHealthCard = await issuer.issue(createValidFHIRBundle())
      const result = await manifestBuilder.addHealthCard({ shc: originalHealthCard })
      const storagePath = result.storagePath

      const updatedBundle = {
        ...createValidFHIRBundle(),
        id: 'updated-bundle',
      }
      const updatedHealthCard = await issuer.issue(updatedBundle)

      const beforeUpdate = new Date()
      await manifestBuilder.updateHealthCard(storagePath, updatedHealthCard)
      const afterUpdate = new Date()

      expect(manifestBuilder.files).toHaveLength(1)
      const updatedFile = manifestBuilder.files[0]
      expect(updatedFile).toBeDefined()
      expect(updatedFile?.storagePath).toBe(storagePath)
      expect(updatedFile?.type).toBe('application/smart-health-card')
      if (updatedFile?.lastUpdated) {
        const lastUpdated = new Date(updatedFile.lastUpdated).getTime()
        expect(lastUpdated).toBeGreaterThanOrEqual(beforeUpdate.getTime())
        expect(lastUpdated).toBeLessThanOrEqual(afterUpdate.getTime())
      } else {
        throw new Error('lastUpdated is not defined')
      }

      // Verify the content was actually updated
      const encryptedContent = uploadedFiles.get(storagePath)
      expect(encryptedContent).toBeDefined()
      const { content: decryptedJson } = await decryptSHLFile({
        jwe: encryptedContent as string,
        key: shl.key,
      })
      const decryptedFile = JSON.parse(decryptedJson)
      expect(decryptedFile.verifiableCredential).toEqual([updatedHealthCard.asJWS()])
    })

    it('should update Smart Health Card files with JWS string', async () => {
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })

      const originalHealthCard = await issuer.issue(createValidFHIRBundle())
      const result = await manifestBuilder.addHealthCard({ shc: originalHealthCard })

      const updatedBundle = { ...createValidFHIRBundle(), id: 'updated' }
      const updatedHealthCard = await issuer.issue(updatedBundle)
      const updatedJWS = updatedHealthCard.asJWS()

      await manifestBuilder.updateHealthCard(result.storagePath, updatedJWS)

      // Verify the content was updated
      const encryptedContent = uploadedFiles.get(result.storagePath)
      expect(encryptedContent).toBeDefined()
      const { content: decryptedJson } = await decryptSHLFile({
        jwe: encryptedContent as string,
        key: shl.key,
      })
      const decryptedFile = JSON.parse(decryptedJson)
      expect(decryptedFile.verifiableCredential).toEqual([updatedJWS])
    })

    it('should throw error when trying to update non-Smart Health Card file', async () => {
      const result = await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })

      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())

      await expect(
        manifestBuilder.updateHealthCard(result.storagePath, healthCard)
      ).rejects.toThrow(
        `File at storage path '${result.storagePath}' is not a Smart Health Card (type: application/fhir+json)`
      )
    })

    it('should handle storage errors during Smart Health Card update', async () => {
      const builderWithFailingUpdate = new SHLManifestBuilder({
        shl,
        uploadFile: async (content: string) => {
          const fileId = `file-${uploadedFiles.size + 1}`
          uploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://files.example.org/${path}`,
        updateFile: async () => {
          throw new Error('Storage update failed')
        },
      })

      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())
      const result = await builderWithFailingUpdate.addHealthCard({ shc: healthCard })

      const updatedHealthCard = await issuer.issue({ ...createValidFHIRBundle(), id: 'updated' })

      await expect(
        builderWithFailingUpdate.updateHealthCard(result.storagePath, updatedHealthCard)
      ).rejects.toThrow('Failed to update Smart Health Card in storage: Storage update failed')
    })
  })

  describe('File Finding', () => {
    it('should find existing files by storage path', async () => {
      const fhirResult = await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })

      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())
      const shcResult = await manifestBuilder.addHealthCard({ shc: healthCard })

      const foundFhir = manifestBuilder.findFile(fhirResult.storagePath)
      const foundShc = manifestBuilder.findFile(shcResult.storagePath)

      expect(foundFhir).not.toBeNull()
      expect(foundFhir?.type).toBe('application/fhir+json')
      expect(foundFhir?.storagePath).toBe(fhirResult.storagePath)

      expect(foundShc).not.toBeNull()
      expect(foundShc?.type).toBe('application/smart-health-card')
      expect(foundShc?.storagePath).toBe(shcResult.storagePath)
    })

    it('should return null for non-existent files', () => {
      const found = manifestBuilder.findFile('nonexistent-file')
      expect(found).toBeNull()
    })

    it('should return null for removed files', async () => {
      const result = await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })
      const storagePath = result.storagePath

      expect(manifestBuilder.findFile(storagePath)).not.toBeNull()
      await manifestBuilder.removeFile(storagePath)
      expect(manifestBuilder.findFile(storagePath)).toBeNull()
    })
  })

  describe('Persistence and Reconstruction with File Management Functions', () => {
    it('should handle persistence with file management functions', async () => {
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
      })
      const healthCard = await issuer.issue(createValidFHIRBundle())
      await manifestBuilder.addHealthCard({ shc: healthCard })
      await manifestBuilder.addFHIRResource({ content: createValidFHIRBundle() })

      const builderAttrs = manifestBuilder.toDBAttrs()

      const newUploadedFiles = new Map<string, string>()
      const newRemovedFiles = new Set<string>()

      const reconstructedBuilder = SHLManifestBuilder.fromDBAttrs({
        shl: shl.payload,
        attrs: builderAttrs,
        uploadFile: async (content: string) => {
          const fileId = `new-file-${newUploadedFiles.size + 1}`
          newUploadedFiles.set(fileId, content)
          return fileId
        },
        getFileURL: async (path: string) => `https://newfiles.example.org/${path}`,
        loadFile: async (path: string) => {
          // Simulate loading from original or new storage
          return uploadedFiles.get(path) || newUploadedFiles.get(path) || ''
        },
        removeFile: async (path: string) => {
          uploadedFiles.delete(path)
          newUploadedFiles.delete(path)
          newRemovedFiles.add(path)
        },
        updateFile: async (path: string, content: string) => {
          if (uploadedFiles.has(path)) {
            uploadedFiles.set(path, content)
          } else {
            newUploadedFiles.set(path, content)
          }
        },
      })

      expect(reconstructedBuilder.files).toHaveLength(2)

      // Test that file operations work on reconstructed builder
      const fhirFile = reconstructedBuilder.files.find(f => f.type === 'application/fhir+json')
      expect(fhirFile).toBeDefined()
      const fhirStoragePath = fhirFile?.storagePath as string
      await reconstructedBuilder.removeFile(fhirStoragePath)
      expect(reconstructedBuilder.files).toHaveLength(1)
      expect(newRemovedFiles.has(fhirStoragePath)).toBe(true)
    })

    it('should handle persistence without file management functions', async () => {
      const builderAttrs = manifestBuilder.toDBAttrs()

      const reconstructedBuilder = SHLManifestBuilder.fromDBAttrs({
        shl: shl.payload,
        attrs: builderAttrs,
        uploadFile: async () => 'new-file',
        getFileURL: async (path: string) => `https://example.org/${path}`,
      })

      expect(reconstructedBuilder.files).toHaveLength(0)

      // Operations requiring file management functions should throw
      await expect(reconstructedBuilder.removeFile('any-path')).rejects.toThrow(
        'File removal is not supported'
      )

      const result = await reconstructedBuilder.addFHIRResource({
        content: createValidFHIRBundle(),
      })
      await expect(
        reconstructedBuilder.updateFHIRResource(result.storagePath, createValidFHIRBundle())
      ).rejects.toThrow('File updates are not supported')
    })
  })

  describe('SHL Expiration', () => {
    it('should work normally for SHL with expiration in the future', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
      const shlWithFutureExpiration = SHL.generate({
        baseManifestURL: 'https://shl.example.org/manifests/',
        manifestPath: '/manifest.json',
        expirationDate: futureDate,
      })

      const builderWithFutureExpiration = new SHLManifestBuilder({
        shl: shlWithFutureExpiration,
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

      await builderWithFutureExpiration.addFHIRResource({ content: createValidFHIRBundle() })
      const manifest = await builderWithFutureExpiration.buildManifest()
      expect(manifest.files).toHaveLength(1)
    })

    it('should throw SHLExpiredError for expired SHL', async () => {
      const pastDate = new Date(Date.now() - 1000) // 1 second ago
      const expiredShl = SHL.generate({
        baseManifestURL: 'https://shl.example.org/manifests/',
        manifestPath: '/manifest.json',
        expirationDate: pastDate,
      })

      const builderWithExpiredShl = new SHLManifestBuilder({
        shl: expiredShl,
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

      await builderWithExpiredShl.addFHIRResource({ content: createValidFHIRBundle() })
      await expect(builderWithExpiredShl.buildManifest()).rejects.toThrow(SHLExpiredError)
      await expect(builderWithExpiredShl.buildManifest()).rejects.toThrow('SHL has expired')
    })
  })
})
