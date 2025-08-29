import { base64url } from 'jose'
import { describe, expect, it } from 'vitest'
import { SHL, SHLFormatError } from '@/index'

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
})
