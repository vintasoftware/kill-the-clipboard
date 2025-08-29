import { base64url } from 'jose'
import { describe, expect, it } from 'vitest'
import { SHL, SHLFormatError } from '@/index'
import { decodeQRFromDataURL } from '../helpers'

describe('SHL Class', () => {
  it('should create a valid SHL with basic properties', () => {
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      label: 'Test Health Card',
    })

    expect(shl.url).toMatch(/^https:\/\/shl\.example\.org\/[A-Za-z0-9_-]{43}\/$/)
    expect(shl.label).toBe('Test Health Card')
    expect(shl.version).toBe(1)
    expect(shl.requiresPasscode).toBe(false)
    expect(shl.isLongTerm).toBe(false)
    expect(shl.key).toHaveLength(43)
  })

  it('should create a valid SHL with flags and expiration', () => {
    const expirationDate = new Date('2025-12-31T23:59:59Z')
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      flag: 'LP',
      expirationDate,
      label: 'Long-term protected health card',
    })

    expect(shl.flag).toBe('LP')
    expect(shl.requiresPasscode).toBe(true)
    expect(shl.isLongTerm).toBe(true)
    expect(shl.expirationDate).toEqual(expirationDate)
    expect(shl.exp).toBe(Math.floor(expirationDate.getTime() / 1000))
  })

  it('should generate valid SHLink URIs', () => {
    const shl = SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'Test Card' })
    const uri = shl.generateSHLinkURI()
    expect(uri).toMatch(/^shlink:\/[A-Za-z0-9_-]+$/)
  })

  it('should generate a SHLink with valid payload', () => {
    const expirationDate = new Date('2025-12-31T23:59:59Z')
    const shl = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      manifestPath: 'manifest.json',
      flag: 'LP',
      expirationDate,
      label: 'Test Card',
    })
    const uri = shl.generateSHLinkURI()
    // biome-ignore lint/style/noNonNullAssertion: uri split is ensured
    const payload = JSON.parse(new TextDecoder().decode(base64url.decode(uri.split('/')[1]!)))

    expect(payload).toEqual(shl.payload)
    expect(payload.v).toBe(1)
    expect(payload.url).toMatch(/^https:\/\/shl\.example\.org\/[A-Za-z0-9_-]{43}\/manifest\.json$/)
    expect(payload.flag).toBe('LP')
    expect(payload.exp).toBe(Math.floor(expirationDate.getTime() / 1000))
    expect(payload.label).toBe('Test Card')
  })

  it('should throw error for invalid label length', () => {
    expect(() =>
      SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'x'.repeat(81) })
    ).toThrow(SHLFormatError)
  })

  it('should reconstruct from payload correctly', () => {
    const original = SHL.generate({
      baseManifestURL: 'https://shl.example.org',
      manifestPath: 'manifest.json',
      flag: 'P',
      label: 'Reconstructed',
      expirationDate: new Date('2030-01-01T00:00:00Z'),
    })

    const reconstructed = SHL.fromPayload(original.payload)
    expect(reconstructed.url).toBe(original.url)
    expect(reconstructed.key).toBe(original.key)
    expect(reconstructed.flag).toBe(original.flag)
    expect(reconstructed.label).toBe(original.label)
    expect(reconstructed.exp).toBe(original.exp)
    expect(reconstructed.payload).toEqual(original.payload)
  })

  it('should handle different baseManifestURL formats correctly', () => {
    const testCases = [
      {
        baseManifestURL: 'https://shl.example.org/manifests/',
        manifestPath: '/manifest.json',
        expectedPattern:
          /^https:\/\/shl\.example\.org\/manifests\/[A-Za-z0-9_-]{43}\/manifest\.json$/,
      },
      {
        baseManifestURL: 'https://api.example.com/v1/shl',
        expectedPattern: /^https:\/\/api\.example\.com\/v1\/shl\/[A-Za-z0-9_-]{43}\/$/,
      },
      {
        baseManifestURL: 'https://health.gov/links',
        manifestPath: '/data.json',
        expectedPattern: /^https:\/\/health\.gov\/links\/[A-Za-z0-9_-]{43}\/data\.json$/,
      },
    ]

    for (const testCase of testCases) {
      const shl = SHL.generate(
        testCase.manifestPath
          ? {
              baseManifestURL: testCase.baseManifestURL,
              manifestPath: testCase.manifestPath,
            }
          : {
              baseManifestURL: testCase.baseManifestURL,
            }
      )

      expect(shl.url).toMatch(testCase.expectedPattern)
      const url = new URL(shl.url)
      const pathSegments = url.pathname.split('/')
      const entropySegment = pathSegments[pathSegments.length - 2]
      expect(entropySegment).toHaveLength(43)
      expect(entropySegment).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  describe('QR Code Generation', () => {
    const baseSHL = SHL.generate({ baseManifestURL: 'https://shl.example.org', label: 'Test QR' })

    it('should generate valid QR codes with various options', async () => {
      const expectedURI = baseSHL.generateSHLinkURI()

      const testCases = [
        {
          options: undefined,
          description: 'default options',
          expectedContent: expectedURI,
        },
        {
          options: { width: 512, errorCorrectionLevel: 'H' as const },
          description: 'custom options',
          expectedContent: expectedURI,
        },
        {
          options: { viewerURL: 'https://viewer.example.org/shl' },
          description: 'viewer URL',
          expectedContent: `https://viewer.example.org/shl#${expectedURI}`,
        },
      ]

      for (const { options, description, expectedContent } of testCases) {
        const qrDataURL = await baseSHL.asQR(options)

        // Validate data URL format
        expect(qrDataURL, `Failed for ${description}`).toMatch(/^data:image\/png;base64,/)
        expect(qrDataURL.length, `Invalid length for ${description}`).toBeGreaterThan(100)

        // Validate QR code content by reading it back
        const decodedContent = decodeQRFromDataURL(qrDataURL)
        expect(decodedContent, `QR decode failed for ${description}`).toBe(expectedContent)
      }
    })
  })

  describe('SHLink URI Parsing', () => {
    it('should parse valid SHLink URIs correctly', () => {
      const testCases = [
        {
          name: 'bare URI',
          shl: SHL.generate({
            baseManifestURL: 'https://shl.example.org',
            flag: 'P',
            label: 'Parse Test',
            expirationDate: new Date('2030-01-01T00:00:00Z'),
          }),
          uriTransform: (uri: string) => uri,
        },
        {
          name: 'viewer-prefixed URI',
          shl: SHL.generate({ baseManifestURL: 'https://shl.example.org', flag: 'LP' }),
          uriTransform: (uri: string) => `https://viewer.example.org/shl#${uri}`,
        },
      ]

      for (const { name, shl, uriTransform } of testCases) {
        const uri = uriTransform(shl.generateSHLinkURI())
        const parsed = SHL.parseSHLinkURI(uri)

        expect(parsed.payload, `Failed for ${name}`).toEqual(shl.payload)
        expect(parsed.generateSHLinkURI()).toBe(shl.generateSHLinkURI())
      }
    })

    it('should throw SHLFormatError for invalid URIs', () => {
      const invalidCases = [
        'invalid-uri',
        'http://example.org',
        'shlink:/',
        'shlink:/invalid-base64',
        `shlink:/${base64url.encode(new TextEncoder().encode('invalid json'))}`,
        `shlink:/${base64url.encode(new TextEncoder().encode(JSON.stringify({ key: 'test-key-that-is-43-characters-long-base64url' })))}`,
      ]

      for (const invalidURI of invalidCases) {
        expect(() => SHL.parseSHLinkURI(invalidURI)).toThrow(SHLFormatError)
      }
    })

    it('should handle round-trip parsing with all field types', () => {
      const comprehensive = SHL.generate({
        baseManifestURL: 'https://comprehensive.example.org',
        manifestPath: '/v2/manifest.json',
        flag: 'LP',
        label: 'Comprehensive Test',
        expirationDate: new Date('2024-12-31T23:59:59.999Z'),
      })

      const uri = comprehensive.generateSHLinkURI()
      const parsed = SHL.parseSHLinkURI(uri)

      // Verify all properties preserved
      expect(parsed.url).toBe(comprehensive.url)
      expect(parsed.key).toBe(comprehensive.key)
      expect(parsed.flag).toBe(comprehensive.flag)
      expect(parsed.label).toBe(comprehensive.label)
      expect(parsed.requiresPasscode).toBe(comprehensive.requiresPasscode)
      expect(parsed.isLongTerm).toBe(comprehensive.isLongTerm)
      expect(parsed.exp).toBe(comprehensive.exp)
    })
  })
})
