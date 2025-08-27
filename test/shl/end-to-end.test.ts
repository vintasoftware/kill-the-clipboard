import { describe, expect, it } from 'vitest'
import { SHL, SHLManifestBuilder } from '@/index'
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
      getFileURL: (path: string) => `https://files.example.org/${path}`,
      loadFile: async (path: string) => {
        const content = uploadedFiles.get(path)
        if (!content) throw new Error(`File not found: ${path}`)
        return content
      },
    })

    const fhirBundle = createValidFHIRBundle()
    await manifestBuilder.addFHIRResource({ content: fhirBundle })

    const manifest = await manifestBuilder.buildManifest()
    expect(manifest.files).toHaveLength(1)

    const shlinkURI = shl.generateSHLinkURI()
    expect(shlinkURI).toMatch(/^shlink:\/[A-Za-z0-9_-]+$/)

    const parsed = new URL(`https://viewer.example/#${shlinkURI}`).hash.substring(1)
    expect(parsed).toMatch(/^shlink:\/\w+/)
  })
})
