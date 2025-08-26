import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FHIRBundle,
  FhirValidationError,
  JWSError,
  JWSProcessor,
  QRCodeError,
  type SmartHealthCardConfig,
  SmartHealthCardIssuer,
  SmartHealthCardReader,
  type SmartHealthCardReaderConfigParams,
} from '@/index'
import {
  createInvalidBundle,
  createValidFHIRBundle,
  testPrivateKeyPKCS8,
  testPublicKeySPKI,
} from '../helpers'

describe('SmartHealthCard', () => {
  let issuer: SmartHealthCardIssuer
  let reader: SmartHealthCardReader
  let validBundle: FHIRBundle
  let issuerConfig: SmartHealthCardConfig
  let readerConfig: SmartHealthCardReaderConfigParams

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
    issuer = new SmartHealthCardIssuer(issuerConfig)
    reader = new SmartHealthCardReader(readerConfig)
  })

  describe('issue()', () => {
    it('should issue a complete SMART Health Card from FHIR Bundle', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      expect(jws).toBeDefined()
      expect(typeof jws).toBe('string')
      expect(jws.split('.')).toHaveLength(3)
    })

    it('should issue SMART Health Card with CryptoKey objects', async () => {
      const { importPKCS8, importSPKI } = await import('jose')

      const privateKeyCrypto = await importPKCS8(testPrivateKeyPKCS8, 'ES256')
      const publicKeyCrypto = await importSPKI(testPublicKeySPKI, 'ES256')

      const configWithCryptoKeys: SmartHealthCardConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: privateKeyCrypto,
        publicKey: publicKeyCrypto,
        expirationTime: null,
        enableQROptimization: false,
        strictReferences: true,
      }
      const issuerWithCryptoKeys = new SmartHealthCardIssuer(configWithCryptoKeys)
      const readerWithCryptoKeys = new SmartHealthCardReader({
        publicKey: publicKeyCrypto,
        enableQROptimization: false,
        strictReferences: true,
      })

      const healthCard = await issuerWithCryptoKeys.issue(validBundle)
      const jws = healthCard.asJWS()

      expect(jws).toBeDefined()
      expect(typeof jws).toBe('string')
      expect(jws.split('.')).toHaveLength(3)

      const verifiedHealthCard = await readerWithCryptoKeys.fromJWS(jws)
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toBeDefined()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should issue health card with expiration when configured', async () => {
      const configWithExpiration: SmartHealthCardConfig = {
        ...issuerConfig,
        expirationTime: 3600,
      }
      const issuerWithExpiration = new SmartHealthCardIssuer(configWithExpiration)

      const healthCard = await issuerWithExpiration.issue(validBundle)
      const jws = healthCard.asJWS()
      expect(jws).toBeDefined()

      const jwsProcessor = new JWSProcessor()
      const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
      expect(verified.exp).toBeDefined()
      expect((verified.exp as number) > verified.nbf).toBe(true)
    })

    it('should throw error for invalid FHIR Bundle', async () => {
      const invalidBundle = createInvalidBundle()

      await expect(issuer.issue(invalidBundle)).rejects.toThrow(FhirValidationError)
      await expect(issuer.issue(invalidBundle)).rejects.toThrow(
        'Invalid bundle: must be a FHIR Bundle resource'
      )
    })

    it('should throw error for null bundle', async () => {
      await expect(issuer.issue(null as unknown as any)).rejects.toThrow(FhirValidationError)
    })

    it('should include correct issuer in JWT payload', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      const jwsProcessor = new JWSProcessor()
      const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
      expect(verified.iss).toBe(issuerConfig.issuer)
      expect(verified.nbf).toBeDefined()
      expect(verified.vc).toBeDefined()
    })

    it('should create verifiable credential with correct structure', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      const jwsProcessor = new JWSProcessor()
      const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
      expect(verified.vc.type).toContain('https://smarthealth.cards#health-card')
      expect(verified.vc.credentialSubject).toBeDefined()
      expect(verified.vc.credentialSubject.fhirBundle).toEqual(validBundle)
    })
  })

  describe('verification with SmartHealthCardReader', () => {
    it('should verify a valid SMART Health Card', async () => {
      const healthCard = await issuer.issue(validBundle)
      const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toBeDefined()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should throw error for invalid JWS', async () => {
      await expect(reader.fromJWS('invalid.jws.signature')).rejects.toThrow(JWSError)
    })

    it('should throw error for tampered health card', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      const tamperedCard = `${jws.slice(0, -5)}XXXXX`

      await expect(reader.fromJWS(tamperedCard)).rejects.toThrow(JWSError)
    })

    it('should validate round-trip: issue then verify', async () => {
      const healthCard = await issuer.issue(validBundle)
      const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toEqual(validBundle)
      expect(verifiedBundle.resourceType).toBe('Bundle')
    })
  })

  describe('SmartHealthCard object methods', () => {
    it('should return the original bundle with asBundle()', async () => {
      const healthCard = await issuer.issue(validBundle)
      const bundleFromCard = await healthCard.asBundle()

      expect(bundleFromCard).toEqual(validBundle)
    })

    it('should return the original bundle with getOriginalBundle()', async () => {
      const healthCard = await issuer.issue(validBundle)
      const originalBundle = healthCard.getOriginalBundle()

      expect(originalBundle).toEqual(validBundle)
    })

    it('should return JWS string with asJWS()', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      expect(typeof jws).toBe('string')
      expect(jws.split('.')).toHaveLength(3)
    })

    it('should return optimized bundle when asBundle() is called with optimizeForQR=true', async () => {
      const healthCard = await issuer.issue(validBundle)
      const optimizedBundle = await healthCard.asBundle({
        optimizeForQR: true,
        strictReferences: true,
      })

      expect(optimizedBundle).toBeDefined()
      expect(optimizedBundle.resourceType).toBe('Bundle')

      if (optimizedBundle.entry) {
        optimizedBundle.entry.forEach((entry, index) => {
          expect(entry.fullUrl).toBe(`resource:${index}`)
        })
      }

      optimizedBundle.entry?.forEach(entry => {
        expect(entry.resource).not.toHaveProperty('id')
      })
    })

    it('should return original bundle when asBundle() is called with optimizeForQR=false', async () => {
      const healthCard = await issuer.issue(validBundle)
      const originalBundle = await healthCard.asBundle({ optimizeForQR: false })

      expect(originalBundle).toBeDefined()
      expect(originalBundle).toEqual(validBundle)
    })
  })

  describe('file operations with new API', () => {
    it('should create file content and read back correctly', async () => {
      const healthCard = await issuer.issue(validBundle)
      const fileContent = await healthCard.asFileContent()

      const verifiedHealthCard = await reader.fromFileContent(fileContent)
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toEqual(validBundle)
      expect(verifiedBundle.resourceType).toBe('Bundle')
      expect(verifiedBundle.entry).toHaveLength(2)
    })

    it('should create file blob and read back correctly', async () => {
      const healthCard = await issuer.issue(validBundle)
      const fileBlob = await healthCard.asFileBlob()

      expect(fileBlob).toBeInstanceOf(Blob)
      expect(fileBlob.type).toBe('application/smart-health-card')

      const verifiedHealthCard = await reader.fromFileContent(fileBlob)
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toEqual(validBundle)
      expect(verifiedBundle.resourceType).toBe('Bundle')
      expect(verifiedBundle.entry).toHaveLength(2)
    })

    it('should handle round-trip file operations', async () => {
      const healthCard = await issuer.issue(validBundle)
      const fileBlob = await healthCard.asFileBlob()

      const verifiedHealthCard = await reader.fromFileContent(fileBlob)
      const extractedBundle = await verifiedHealthCard.asBundle()

      expect(extractedBundle).toEqual(validBundle)
    })
  })

  describe('SmartHealthCard output formats', () => {
    it('should create file content in correct format', async () => {
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

    it('should create downloadable file blob', async () => {
      const healthCard = await issuer.issue(validBundle)
      const blob = await healthCard.asFileBlob()

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/smart-health-card')
      expect(blob.size).toBeGreaterThan(0)
    })

    it('should generate QR codes', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrCodes = await healthCard.asQR()

      expect(Array.isArray(qrCodes)).toBe(true)
      expect(qrCodes.length).toBeGreaterThan(0)
      qrCodes.forEach(qr => {
        expect(typeof qr).toBe('string')
        expect(qr).toMatch(/^data:image\/png;base64,/)
      })
    })

    it('should generate QR numeric strings', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrNumericStrings = healthCard.asQRNumeric()

      expect(Array.isArray(qrNumericStrings)).toBe(true)
      expect(qrNumericStrings.length).toBeGreaterThan(0)
      qrNumericStrings.forEach(qrString => {
        expect(typeof qrString).toBe('string')
        expect(qrString).toMatch(/^shc:\//)
      })
      expect(qrNumericStrings).toHaveLength(1)
    })

    it('should generate chunked QR numeric strings when configured', async () => {
      const healthCard = await issuer.issue(validBundle)
      const chunkedQRStrings = healthCard.asQRNumeric({
        enableChunking: true,
        maxSingleQRSize: 100,
      })

      expect(Array.isArray(chunkedQRStrings)).toBe(true)
      expect(chunkedQRStrings.length).toBeGreaterThan(1)

      chunkedQRStrings.forEach((qrString, index) => {
        expect(typeof qrString).toBe('string')
        expect(qrString).toMatch(/^shc:\/\d+\/\d+\//)
        const parts = qrString.split('/')
        expect(parts).toHaveLength(4)
        expect(parseInt(parts[1])).toBe(index + 1)
        expect(parseInt(parts[2])).toBe(chunkedQRStrings.length)
      })
    })
  })

  describe('fromQRNumeric() method', () => {
    it('should read and verify a SMART Health Card from single QR numeric data', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrNumericStrings = healthCard.asQRNumeric()
      expect(qrNumericStrings).toHaveLength(1)

      const verifiedHealthCard = await reader.fromQRNumeric(qrNumericStrings[0])
      expect(verifiedHealthCard).toBeDefined()
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should read and verify a SMART Health Card from chunked QR numeric data', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrChunks = healthCard.asQRNumeric({ enableChunking: true, maxSingleQRSize: 100 })
      expect(qrChunks.length).toBeGreaterThan(1)

      const verifiedHealthCard = await reader.fromQRNumeric(qrChunks)
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should surface QRCodeError from QR decoding', async () => {
      await expect(reader.fromQRNumeric('invalid-qr-data')).rejects.toThrow(QRCodeError)
      await expect(reader.fromQRNumeric('invalid-qr-data')).rejects.toThrow(
        "Invalid QR code format. Expected 'shc:/' prefix."
      )
    })
  })

  describe('end-to-end workflow', () => {
    it('should handle complete SMART Health Card workflow', async () => {
      const healthCard = await issuer.issue(validBundle)
      expect(healthCard).toBeDefined()

      const jws = healthCard.asJWS()
      expect(jws).toBeDefined()
      expect(typeof jws).toBe('string')

      const verifiedHealthCard = await reader.fromJWS(jws)
      expect(verifiedHealthCard).toBeDefined()

      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should handle complete file-based workflow', async () => {
      const healthCard = await issuer.issue(validBundle)
      const blob = await healthCard.asFileBlob()
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/smart-health-card')

      const verifiedHealthCard = await reader.fromFileContent(blob)
      expect(verifiedHealthCard).toBeDefined()
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should handle complete QR numeric workflow', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrNumericChunks = healthCard.asQRNumeric()
      expect(qrNumericChunks).toHaveLength(1)

      const verifiedHealthCard = await reader.fromQRNumeric(qrNumericChunks[0])
      expect(verifiedHealthCard).toBeDefined()
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should handle complete chunked QR numeric workflow', async () => {
      const healthCard = await issuer.issue(validBundle)
      const qrNumericChunks = healthCard.asQRNumeric({ enableChunking: true, maxSingleQRSize: 150 })
      expect(qrNumericChunks.length).toBeGreaterThan(1)

      const verifiedHealthCard = await reader.fromQRNumeric(qrNumericChunks)
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(validBundle)
    })
  })
})
