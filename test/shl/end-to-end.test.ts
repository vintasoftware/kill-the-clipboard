import { describe, expect, it } from 'vitest'
import {
  FHIRBundleProcessor,
  SHL,
  SHLManifestBuilder,
  SHLViewer,
  SmartHealthCardIssuer,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('End-to-End SHL Workflow', () => {
  it('should handle complete SHL creation and URI generation workflow', async () => {
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org/manifests/',
      manifestPath: '/manifest.json',
      label: 'Complete Test Card',
      flag: 'L',
    })

    const uploadedFiles = new Map<string, string>()
    const manifestBuilder = new SHLManifestBuilder({
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

    // Add a FHIR bundle (will be a 'embedded' due to small size)
    const fhirBundle = createValidFHIRBundle()
    await manifestBuilder.addFHIRResource({ content: fhirBundle })

    // Add a SHC (will be 'location' due to larger size)
    const issuer = new SmartHealthCardIssuer({
      issuer: 'https://example.com',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
    })
    const healthCard = await issuer.issue(fhirBundle)
    await manifestBuilder.addHealthCard({ shc: healthCard, enableCompression: true })

    // Persist the builder state
    const builderAttrs = manifestBuilder.toDBAttrs()
    expect(builderAttrs.files).toHaveLength(2)

    // Store the SHL payload separately
    const shlPayload = shl.payload

    // Generate the SHL URI
    const shlinkURI = shl.toURI()
    expect(shlinkURI).toMatch(/^shlink:\/[A-Za-z0-9_-]+$/)
    const viewerPrefixedURI = `https://viewer.example/#${shlinkURI}`

    // Implement the Manifest URL handler
    const fetchImpl = async (url: string, init?: RequestInit) => {
      // Manifest fetch
      if (init?.method === 'POST' && url === shl.url) {
        // Reconstruct builder on each request and build a fresh manifest
        const reconstructed = SHLManifestBuilder.fromDBAttrs({
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

        const body = JSON.parse(init.body as string) as { embeddedLengthMax: number }
        const freshManifest = await reconstructed.buildManifest({
          embeddedLengthMax: body.embeddedLengthMax,
        })

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(freshManifest),
        } as Response
      }

      // File fetch for the location file
      const fileId = url.split('/').pop()
      if (init?.method === 'GET' && fileId && uploadedFiles.has(fileId)) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => uploadedFiles.get(fileId) as string,
        } as Response
      }

      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
    }

    // Create the SHL viewer and resolve the SHL
    const viewer = new SHLViewer({ shlinkURI: viewerPrefixedURI, fetch: fetchImpl })
    const resolved = await viewer.resolveSHL({
      recipient: 'did:example:alice',
      // Force one embedded, one location with a specific max length
      // biome-ignore lint/style/noNonNullAssertion: file-1 is defined
      embeddedLengthMax: uploadedFiles.get('file-1')!.length,
      shcReaderConfig: {
        publicKey: testPublicKeySPKI,
      },
    })

    if (!resolved.manifest) {
      throw new Error('Manifest is undefined')
    }
    expect(resolved.manifest.files).toHaveLength(2)
    // Check that one file is embedded and the other is a location
    const embeddedFile = resolved.manifest.files.find(f => 'embedded' in f)
    const locationFile = resolved.manifest.files.find(f => 'location' in f)
    expect(embeddedFile).toBeDefined()
    expect(locationFile).toBeDefined()

    // Check resolved content
    expect(resolved.fhirResources).toHaveLength(1)
    expect(resolved.smartHealthCards).toHaveLength(1)
    expect(resolved.fhirResources[0]).toEqual(fhirBundle)
    // biome-ignore lint/style/noNonNullAssertion: smartHealthCards length already asserted to == 1
    expect(resolved.smartHealthCards[0]!.getOriginalBundle()).toEqual(
      new FHIRBundleProcessor().processForQR(fhirBundle)
    )
  })
})
