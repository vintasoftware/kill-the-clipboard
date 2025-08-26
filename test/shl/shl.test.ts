import { describe, expect, it } from 'vitest'
import { SHL, SHLFormatError } from '@/index'

describe('SHL Class', () => {
  it('should create a valid SHL with basic properties', () => {
    const shl = SHL.generate({ baseURL: 'https://shl.example.org', label: 'Test Health Card' })

    expect(shl.baseURL).toBe('https://shl.example.org')
    expect(shl.label).toBe('Test Health Card')
    expect(shl.version).toBe(1)
    expect(shl.requiresPasscode).toBe(false)
    expect(shl.isLongTerm).toBe(false)
    expect(shl.key).toHaveLength(43)
    expect(shl.manifestPath).toMatch(/^\/manifests\/[A-Za-z0-9_-]{43}\/manifest\.json$/)
  })

  it('should create a valid SHL with flags and expiration', () => {
    const expirationDate = new Date('2025-12-31T23:59:59Z')
    const shl = SHL.generate({
      baseURL: 'https://shl.example.org',
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
    const shl = SHL.generate({ baseURL: 'https://shl.example.org', label: 'Test Card' })
    const uri = shl.generateSHLinkURI()
    expect(uri).toMatch(/^shlink:\/[A-Za-z0-9_-]+$/)
  })

  it('should throw error for invalid label length', () => {
    expect(() =>
      SHL.generate({ baseURL: 'https://shl.example.org', label: 'x'.repeat(81) })
    ).toThrow(SHLFormatError)
  })
})
