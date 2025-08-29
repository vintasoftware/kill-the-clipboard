import { describe, expect, it } from 'vitest'
import { SHL, SHLManifestBuilder, SHLViewer } from '@/index'
import { createValidFHIRBundle } from '../helpers'

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

    const fhirBundle = createValidFHIRBundle()
    await manifestBuilder.addFHIRResource({ content: fhirBundle })

    // Persist the builder state
    const serialized = manifestBuilder.serialize()

    const shlinkURI = shl.generateSHLinkURI()
    expect(shlinkURI).toMatch(/^shlink:\/[A-Za-z0-9_-]+$/)

    const viewerPrefixedURI = `https://viewer.example/#${shlinkURI}`
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === shl.url) {
        // Reconstruct builder on each request and build a fresh manifest
        const reconstructed = SHLManifestBuilder.deserialize({
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

        const freshManifest = await reconstructed.buildManifest()

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(freshManifest),
        } as Response
      }
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response
    }

    const viewer = new SHLViewer({ shlinkURI: viewerPrefixedURI, fetch: fetchImpl })
    const resolved = await viewer.resolveSHLink({ recipient: 'did:example:alice' })

    expect(resolved.manifest.files).toHaveLength(1)
    expect(resolved.fhirResources).toHaveLength(1)
    expect(resolved.fhirResources[0]).toEqual(fhirBundle)
  })
})
