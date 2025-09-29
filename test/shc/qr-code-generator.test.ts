// biome-ignore-all lint/suspicious/noExplicitAny: Tests intentionally cover invalid value branches
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QRCodeError, QRCodeGenerator, SHCIssuer, SHCReader } from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('QRCodeGenerator', () => {
  let qrGenerator: QRCodeGenerator
  let validJWS: string

  beforeEach(async () => {
    qrGenerator = new QRCodeGenerator()

    const issuer = new SHCIssuer({
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: false,
      strictReferences: true,
    })

    const validBundle = createValidFHIRBundle()
    const healthCard = await issuer.issue(validBundle)
    validJWS = healthCard.asJWS()
  })

  describe('generateQR()', () => {
    it('should generate a single QR code data URL', async () => {
      const qrDataUrls = await qrGenerator.generateQR(validJWS)

      expect(qrDataUrls).toBeDefined()
      expect(Array.isArray(qrDataUrls)).toBe(true)
      expect(qrDataUrls).toHaveLength(1)
      expect(qrDataUrls[0]).toMatch(/^data:image\/png;base64,/)
    })

    it('should generate chunked QR codes when enabled and JWS is large', async () => {
      const chunkedGenerator = new QRCodeGenerator({
        enableChunking: true,
        maxSingleQRSize: 100,
      })

      const qrDataUrls = await chunkedGenerator.generateQR(validJWS)

      expect(qrDataUrls).toBeDefined()
      expect(Array.isArray(qrDataUrls)).toBe(true)
      expect(qrDataUrls.length).toBeGreaterThan(1)
      for (const dataUrl of qrDataUrls) {
        expect(dataUrl).toMatch(/^data:image\/png;base64,/)
      }
    })

    it('should throw QRCodeError for invalid JWS characters', async () => {
      const invalidJWS = 'invalid-jws-with-unicode-€'

      await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow('Invalid character')
    })

    it('should use default configuration values', () => {
      const defaultGenerator = new QRCodeGenerator()
      expect(defaultGenerator.config.maxSingleQRSize).toBe(1195)
      expect(defaultGenerator.config.enableChunking).toBe(false)
    })

    it('should respect custom configuration values', () => {
      const customGenerator = new QRCodeGenerator({
        maxSingleQRSize: 2000,
        enableChunking: true,
        encodeOptions: {
          errorCorrectionLevel: 'H',
          scale: 8,
        },
      })

      expect(customGenerator.config.maxSingleQRSize).toBe(2000)
      expect(customGenerator.config.enableChunking).toBe(true)
      expect(customGenerator.config.encodeOptions?.errorCorrectionLevel).toBe('H')
      expect(customGenerator.config.encodeOptions?.scale).toBe(8)
    })

    it('should throw QRCodeError when chunking is required but disabled', async () => {
      const generator = new QRCodeGenerator({
        maxSingleQRSize: 10,
        enableChunking: false,
      })

      const longJWS = 'header.payload.signatureheader.payload.signature'

      await expect(generator.generateQR(longJWS)).rejects.toThrow(QRCodeError)
      await expect(generator.generateQR(longJWS)).rejects.toThrow('exceeds maxSingleQRSize')
    })

    it('should use default maxSingleQRSize when not provided in config', async () => {
      const generator = new QRCodeGenerator({ enableChunking: true })
      const jws = 'a'.repeat(1000)
      const chunks = generator.chunkJWS(jws)
      expect(chunks).toHaveLength(1)
    })

    it('should auto-derive maxSingleQRSize from errorCorrectionLevel', async () => {
      const qrGeneratorL = new QRCodeGenerator()
      expect(qrGeneratorL.config.maxSingleQRSize).toBe(1195)

      const qrGeneratorM = new QRCodeGenerator({ encodeOptions: { errorCorrectionLevel: 'M' } })
      expect(qrGeneratorM.config.maxSingleQRSize).toBe(927)

      const qrGeneratorQ = new QRCodeGenerator({ encodeOptions: { errorCorrectionLevel: 'Q' } })
      expect(qrGeneratorQ.config.maxSingleQRSize).toBe(670)

      const qrGeneratorH = new QRCodeGenerator({ encodeOptions: { errorCorrectionLevel: 'H' } })
      expect(qrGeneratorH.config.maxSingleQRSize).toBe(519)
    })

    it('should respect explicit maxSingleQRSize over auto-derivation', async () => {
      const customSize = 800
      const gen = new QRCodeGenerator({
        maxSingleQRSize: customSize,
        encodeOptions: { errorCorrectionLevel: 'H' },
      })
      expect(gen.config.maxSingleQRSize).toBe(customSize)
    })

    it('should handle empty QR code data array', async () => {
      const generator = new QRCodeGenerator()
      await expect(generator.decodeQR([])).rejects.toThrow(QRCodeError)
      await expect(generator.decodeQR([])).rejects.toThrow('No QR code data provided')
    })

    it('should handle undefined QR data in decodeQR', async () => {
      const generator = new QRCodeGenerator()
      const qrDataWithUndefined = [undefined as unknown as string]
      await expect(generator.decodeQR(qrDataWithUndefined)).rejects.toThrow(QRCodeError)
    })

    it('should accept custom encodeOptions and merge them with SMART Health Cards spec defaults', () => {
      const customGenerator = new QRCodeGenerator({
        encodeOptions: {
          errorCorrectionLevel: 'M',
          scale: 2,
          margin: 3,
          maskPattern: 2,
          version: 10,
        },
      })

      expect(customGenerator.config.encodeOptions).toEqual({
        errorCorrectionLevel: 'M',
        scale: 2,
        margin: 3,
        maskPattern: 2,
        version: 10,
        color: { dark: '#000000ff', light: '#ffffffff' },
      })
    })

    it('should use SMART Health Cards specification defaults', () => {
      const defaultGenerator = new QRCodeGenerator()
      const buildEncodeOptions = (defaultGenerator as any).buildEncodeOptions.bind(defaultGenerator)
      const mergedOptions = buildEncodeOptions()

      expect(mergedOptions).toEqual({
        errorCorrectionLevel: 'L',
        scale: 4,
        margin: 1,
        color: { dark: '#000000ff', light: '#ffffffff' },
      })
    })

    it('should generate QR codes with custom encodeOptions applied', async () => {
      const mockToDataURL = vi.fn()
      mockToDataURL.mockResolvedValue('data:image/png;base64,AAA')

      vi.doMock('qrcode', () => ({ toDataURL: mockToDataURL }))

      const simpleJWS = 'header.payload.signature'

      const customGenerator = new QRCodeGenerator({
        encodeOptions: { errorCorrectionLevel: 'H', scale: 6, margin: 0, version: 5 },
      })

      const qrDataUrls = await customGenerator.generateQR(simpleJWS)

      const expectedNumeric = '595652555669016752766366525501706058655271726956'
      expect(mockToDataURL).toHaveBeenCalledWith(
        [
          { data: new TextEncoder().encode('shc:/'), mode: 'byte' },
          { data: expectedNumeric, mode: 'numeric' },
        ],
        {
          errorCorrectionLevel: 'H',
          scale: 6,
          margin: 0,
          version: 5,
          color: { dark: '#000000ff', light: '#ffffffff' },
        }
      )

      expect(qrDataUrls).toBeDefined()
      expect(Array.isArray(qrDataUrls)).toBe(true)
      expect(qrDataUrls).toHaveLength(1)
      expect(qrDataUrls[0]).toMatch(/^data:image\/png;base64,/)

      vi.doUnmock('qrcode')
    })
  })

  describe('decodeQR()', () => {
    it('should decode a single QR code back to original JWS', async () => {
      const qrDataUrls = await qrGenerator.generateQR(validJWS)
      expect(qrDataUrls).toHaveLength(1)

      const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
      const qrContent = `shc:/${numericData}`

      const decodedJWS = await qrGenerator.decodeQR([qrContent])
      expect(decodedJWS).toBe(validJWS)
    })

    it('should decode chunked QR codes back to original JWS', async () => {
      const chunkedGenerator = new QRCodeGenerator({ enableChunking: true, maxSingleQRSize: 100 })

      const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
      const chunkSize = 80
      const chunks: string[] = []
      for (let i = 0; i < numericData.length; i += chunkSize) {
        chunks.push(numericData.substring(i, i + chunkSize))
      }
      const qrContents = chunks.map((chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`)

      const decodedJWS = await qrGenerator.decodeQR(qrContents)
      expect(decodedJWS).toBe(validJWS)
    })

    it('should throw QRCodeError for empty QR data', async () => {
      await expect(qrGenerator.decodeQR([])).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR([])).rejects.toThrow('No QR code data provided')
    })

    it('should throw QRCodeError for invalid QR format', async () => {
      await expect(qrGenerator.decodeQR(['invalid-qr-data'])).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(['invalid-qr-data'])).rejects.toThrow(
        "Invalid QR code format. Expected 'shc:/' prefix"
      )
    })

    it('should throw QRCodeError for invalid chunked format', async () => {
      const invalidChunked = ['shc:/1/2', 'shc:/2/2/data']
      await expect(qrGenerator.decodeQR(invalidChunked)).rejects.toThrow(QRCodeError)
    })

    it("should throw QRCodeError when a chunk doesn't start with shc:/ prefix", async () => {
      const badPrefix = ['invalidprefix:/1/1/00', 'shc:/1/1/00']
      await expect(qrGenerator.decodeQR(badPrefix)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(badPrefix)).rejects.toThrow(
        "Invalid chunked QR code format. Expected 'shc:/' prefix."
      )
    })

    it('should throw QRCodeError for chunked entries with missing parts', async () => {
      await expect(qrGenerator.decodeQR(['shc:/1//1234', 'shc:/2/2/5678'])).rejects.toThrow(
        QRCodeError
      )
      await expect(qrGenerator.decodeQR(['shc:/1//1234', 'shc:/2/2/5678'])).rejects.toThrow(
        'Invalid chunked QR code format: missing parts'
      )

      await expect(qrGenerator.decodeQR(['shc:/1/2/', 'shc:/2/2/1234'])).rejects.toThrow(
        QRCodeError
      )
      await expect(qrGenerator.decodeQR(['shc:/1/2/', 'shc:/2/2/1234'])).rejects.toThrow(
        'Invalid chunked QR code format: missing parts'
      )
    })

    it('should throw QRCodeError for invalid chunk index or total in chunked QR', async () => {
      await expect(qrGenerator.decodeQR(['shc:/0/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        QRCodeError
      )
      await expect(qrGenerator.decodeQR(['shc:/0/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        'Invalid chunk index or total in QR code'
      )

      await expect(qrGenerator.decodeQR(['shc:/3/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        QRCodeError
      )
      await expect(qrGenerator.decodeQR(['shc:/3/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        'Invalid chunk index or total in QR code'
      )

      await expect(qrGenerator.decodeQR(['shc:/a/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        QRCodeError
      )
      await expect(qrGenerator.decodeQR(['shc:/a/2/12', 'shc:/2/2/34'])).rejects.toThrow(
        'Invalid chunk index or total in QR code'
      )
    })

    it('should throw QRCodeError for empty numeric payload in single QR', async () => {
      await expect(qrGenerator.decodeQR(['shc:/'])).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(['shc:/'])).rejects.toThrow(
        'Invalid numeric data: cannot parse digit pairs'
      )
    })

    it('should throw QRCodeError for missing chunks', async () => {
      const incompleteChunks = ['shc:/1/3/123456', 'shc:/3/3/789012']
      await expect(qrGenerator.decodeQR(incompleteChunks)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(incompleteChunks)).rejects.toThrow(
        'Missing chunks. Expected 3, got 2'
      )
    })

    it('should throw QRCodeError for inconsistent chunk totals', async () => {
      const inconsistentChunks = ['shc:/1/2/123456', 'shc:/2/3/789012']
      await expect(qrGenerator.decodeQR(inconsistentChunks)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(inconsistentChunks)).rejects.toThrow(
        'Inconsistent total chunk count'
      )
    })

    it('should throw QRCodeError for invalid numeric data', async () => {
      const invalidNumeric = 'shc:/12345'
      await expect(qrGenerator.decodeQR([invalidNumeric])).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR([invalidNumeric])).rejects.toThrow(
        'Invalid numeric data: must have even length'
      )
    })

    it('should throw QRCodeError for out-of-range digit pairs', async () => {
      const outOfRange = 'shc:/9999'
      await expect(qrGenerator.decodeQR([outOfRange])).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR([outOfRange])).rejects.toThrow(
        "Invalid digit pair '99': value 99 exceeds maximum 77"
      )
    })

    it('should throw QRCodeError when total chunk count is inconsistent across inputs', async () => {
      const inconsistentTotals = ['shc:/1/2/1234', 'shc:/2/3/5678']
      await expect(qrGenerator.decodeQR(inconsistentTotals)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(inconsistentTotals)).rejects.toThrow(
        'Inconsistent total chunk count across QR codes'
      )
    })

    it('should throw QRCodeError when chunk total is consistent but missing chunks', async () => {
      const missing = ['shc:/1/3/1111', 'shc:/3/3/2222']
      await expect(qrGenerator.decodeQR(missing)).rejects.toThrow(QRCodeError)
      await expect(qrGenerator.decodeQR(missing)).rejects.toThrow(
        'Missing chunks. Expected 3, got 2'
      )
    })
  })

  describe('chunkJWS() public method', () => {
    it('should return single QR code string for small JWS', () => {
      const smallJWS = 'header.payload.signature'
      const chunks = qrGenerator.chunkJWS(smallJWS)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatch(/^shc:\/\d+$/)

      const numericData = qrGenerator.encodeJWSToNumeric(smallJWS)
      expect(chunks[0]).toBe(`shc:/${numericData}`)
    })

    it('should throw error for invalid JWS input', () => {
      expect(() => qrGenerator.chunkJWS('')).toThrow(QRCodeError)
      expect(() => qrGenerator.chunkJWS('')).toThrow('Invalid JWS: must be a non-empty string')
      expect(() => qrGenerator.chunkJWS(null as unknown as string)).toThrow(QRCodeError)
      expect(() => qrGenerator.chunkJWS(undefined as unknown as string)).toThrow(QRCodeError)
    })

    it('should produce chunks that can be reassembled correctly', () => {
      const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })

      const originalJWS = 'header.payload.verylongsignature'.repeat(10)
      const chunks = generator.chunkJWS(originalJWS)

      expect(chunks.length).toBeGreaterThan(1)

      const numericParts = chunks.map(chunk => {
        const parts = chunk.split('/')
        return parts[parts.length - 1]
      })

      const reassembledNumeric = numericParts.join('')
      const reassembledJWS = generator.decodeNumericToJWS(reassembledNumeric)

      expect(reassembledJWS).toBe(originalJWS)
    })
  })

  describe('numeric encoding/decoding', () => {
    it('should correctly encode and decode all valid base64url characters', () => {
      const base64urlChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_='

      const encoded = qrGenerator.encodeJWSToNumeric(base64urlChars)
      const decoded = qrGenerator.decodeNumericToJWS(encoded)

      expect(decoded).toBe(base64urlChars)
    })

    it('should produce expected numeric values for known characters', () => {
      const testCases = [
        { char: '-', expected: '00' },
        { char: 'A', expected: '20' },
        { char: 'a', expected: '52' },
        { char: 'z', expected: '77' },
        { char: '0', expected: '03' },
        { char: '9', expected: '12' },
      ]

      for (const testCase of testCases) {
        const encoded = qrGenerator.encodeJWSToNumeric(testCase.char)
        expect(encoded).toBe(testCase.expected)
      }
    })

    it('should handle round-trip encoding correctly', () => {
      const jwtHeader = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9'

      const encoded = qrGenerator.encodeJWSToNumeric(jwtHeader)
      const decoded = qrGenerator.decodeNumericToJWS(encoded)

      expect(decoded).toBe(jwtHeader)
    })
  })

  describe('end-to-end QR workflow', () => {
    it('should handle complete QR generation and scanning workflow', async () => {
      const qrDataUrls = await qrGenerator.generateQR(validJWS)
      expect(qrDataUrls).toHaveLength(1)

      const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
      const qrContent = `shc:/${numericData}`

      const scannedJWS = await qrGenerator.decodeQR([qrContent])
      expect(scannedJWS).toBe(validJWS)

      const reader = new SHCReader({
        publicKey: testPublicKeySPKI,
        enableQROptimization: false,
        strictReferences: true,
      })

      const verifiedHealthCard = await reader.fromJWS(scannedJWS)
      expect(verifiedHealthCard).toBeDefined()
      const verifiedBundle = await verifiedHealthCard.asBundle()
      expect(verifiedBundle).toEqual(createValidFHIRBundle())
    })

    it('should handle chunked QR workflow', async () => {
      const chunkedGenerator = new QRCodeGenerator({ enableChunking: true, maxSingleQRSize: 100 })

      const qrDataUrls = await chunkedGenerator.generateQR(validJWS)
      expect(qrDataUrls.length).toBeGreaterThan(1)

      const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
      const chunkSize = 80
      const chunks: string[] = []
      for (let i = 0; i < numericData.length; i += chunkSize) {
        chunks.push(numericData.substring(i, i + chunkSize))
      }
      const qrContents = chunks.map((chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`)

      const scannedJWS = await chunkedGenerator.decodeQR(qrContents)
      expect(scannedJWS).toBe(validJWS)
    })
  })

  describe('Balanced Chunking Algorithm', () => {
    it('should create exactly balanced chunks', () => {
      const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })
      const testJWS = 'a'.repeat(120)
      const chunks = generator.chunkJWS(testJWS)
      expect(chunks).toHaveLength(3)

      const chunkSizes = chunks.map(chunk => {
        const parts = chunk.split('/')
        const numericPart = parts[parts.length - 1]
        return numericPart.length / 2
      })
      expect(chunkSizes).toEqual([40, 40, 40])
    })

    it('should handle uneven divisions correctly', () => {
      const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })
      const testJWS = 'b'.repeat(125)
      const chunks = generator.chunkJWS(testJWS)
      expect(chunks).toHaveLength(3)

      const chunkSizes = chunks.map(chunk => {
        const parts = chunk.split('/')
        const numericPart = parts[parts.length - 1]
        return numericPart.length / 2
      })
      expect(chunkSizes).toEqual([42, 42, 41])
    })

    it('should handle various division cases', () => {
      const generator = new QRCodeGenerator({ maxSingleQRSize: 10 })
      const testCases = [
        { size: 21, expectedSizes: [7, 7, 7] },
        { size: 22, expectedSizes: [8, 8, 6] },
        { size: 30, expectedSizes: [10, 10, 10] },
        { size: 31, expectedSizes: [8, 8, 8, 7] },
      ]

      testCases.forEach(({ size, expectedSizes }) => {
        const testJWS = 'x'.repeat(size)
        const chunks = generator.chunkJWS(testJWS)
        const chunkSizes = chunks.map(chunk => {
          const parts = chunk.split('/')
          const numericPart = parts[parts.length - 1]
          return numericPart.length / 2
        })
        expect(chunkSizes).toEqual(expectedSizes)
      })
    })
  })
})
