import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FHIRBundle,
  FileFormatError,
  type SHCConfig,
  SHCIssuer,
  SHCReader,
  type SHCReaderConfigParams,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('File Format Features', () => {
  let issuer: SHCIssuer
  let reader: SHCReader
  let validBundle: FHIRBundle
  let issuerConfig: SHCConfig
  let readerConfig: SHCReaderConfigParams

  beforeEach(() => {
    validBundle = createValidFHIRBundle()
    issuerConfig = {
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: false,
      strictReferences: true,
    }
    readerConfig = {
      publicKey: testPublicKeySPKI,
      enableQROptimization: false,
      strictReferences: true,
    }
    issuer = new SHCIssuer(issuerConfig)
    reader = new SHCReader(readerConfig)
  })

  it('should create file with JSON wrapper format', async () => {
    const healthCard = await issuer.issue(validBundle)
    const fileContent = await healthCard.asFileContent()

    expect(fileContent).toBeDefined()
    expect(typeof fileContent).toBe('string')

    const parsed = JSON.parse(fileContent)
    expect(parsed).toHaveProperty('verifiableCredential')
    expect(Array.isArray(parsed.verifiableCredential)).toBe(true)
    expect(parsed.verifiableCredential).toHaveLength(1)

    const jws = parsed.verifiableCredential[0]
    expect(typeof jws).toBe('string')
    expect(jws.split('.')).toHaveLength(3)
  })

  it('should verify file with JSON wrapper format', async () => {
    const healthCard = await issuer.issue(validBundle)
    const fileContent = await healthCard.asFileContent()
    const verifiedHealthCard = await reader.fromFileContent(fileContent)
    const verifiedBundle = await verifiedHealthCard.asBundle()

    expect(verifiedBundle).toBeDefined()
    expect(verifiedBundle).toEqual(validBundle)
  })

  it('should throw error for empty verifiableCredential array', async () => {
    const invalidFileContent = JSON.stringify({ verifiableCredential: [] })
    await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(FileFormatError)
    await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(
      'File contains empty verifiableCredential array'
    )
  })

  it('should throw error for missing verifiableCredential property', async () => {
    const invalidFileContent = JSON.stringify({ somethingElse: ['jws'] })
    await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(FileFormatError)
    await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(
      'File does not contain expected verifiableCredential array'
    )
  })
})
