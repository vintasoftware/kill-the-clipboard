// QR code generation for SMART Health Cards

import { QRCodeError } from '../errors.js'
import type { QRCodeConfig, QRCodeConfigParams, QREncodeParams } from '../types.js'

// Version 22 QR code max JWS lengths by error correction level
// Source: SMART Health Cards QR Code FAQ
// See: https://raw.githubusercontent.com/smart-on-fhir/health-cards/refs/heads/main/FAQ/qr.md
const V22_MAX_JWS_BY_EC_LEVEL = {
  L: 1195, // Low error correction
  M: 927, // Medium error correction
  Q: 670, // Quartile error correction
  H: 519, // High error correction
} as const

/**
 * Generates and scans QR codes for SMART Health Cards with proper numeric encoding.
 *
 * @public
 * @group SHC
 * @category Lower-Level API
 */
export class QRCodeGenerator {
  /** The resolved configuration for QR code generation. */
  public readonly config: QRCodeConfig

  /**
   * Creates a new QRCodeGenerator instance.
   *
   * @param config - Optional QR code configuration parameters
   */
  constructor(config: QRCodeConfigParams = {}) {
    // Build encode options first to determine error correction level
    const encodeOptions = this.buildEncodeOptions(config.encodeOptions)

    // Auto-derive maxSingleQRSize from error correction level if not provided
    const maxSingleQRSize =
      config.maxSingleQRSize ?? this.deriveMaxSingleQRSize(encodeOptions.errorCorrectionLevel)

    this.config = {
      maxSingleQRSize,
      enableChunking: config.enableChunking ?? false,
      encodeOptions,
    }
  }

  /**
   * Derives the maximum single QR size based on error correction level
   * Uses Version 22 QR code limits from SMART Health Cards QR Code FAQ
   */
  private deriveMaxSingleQRSize(
    errorCorrectionLevel: Required<QREncodeParams>['errorCorrectionLevel']
  ): number {
    const ecLevel = errorCorrectionLevel
    return V22_MAX_JWS_BY_EC_LEVEL[ecLevel]
  }

  /**
   * Builds the final options object for encodeQR by merging defaults with user options
   * Defaults are aligned with SMART Health Cards specification recommendations
   * @throws never
   */
  private buildEncodeOptions(encodeOptions: QREncodeParams = {}) {
    // Default options aligned with SMART Health Cards specification
    // See: https://spec.smarthealth.cards/#health-cards-as-qr-codes
    const defaultOptions = {
      errorCorrectionLevel: 'L' as const, // L level error correction per SMART Health Cards spec
      scale: 4, // Default scale factor for readability
      margin: 1, // Minimal quiet zone size
      color: {
        dark: '#000000ff', // Black modules (SMART Health Cards compliant)
        light: '#ffffffff', // White background (SMART Health Cards compliant)
      },
    }

    return {
      errorCorrectionLevel:
        encodeOptions.errorCorrectionLevel ?? defaultOptions.errorCorrectionLevel,
      scale: encodeOptions.scale ?? defaultOptions.scale,
      margin: encodeOptions.margin ?? defaultOptions.margin,
      color: encodeOptions.color ?? defaultOptions.color,
      ...encodeOptions,
    }
  }

  /**
   * Generates QR code data URLs from a JWS string.
   *
   * @param jws - JWS string to encode
   * @returns Promise resolving to array of QR code data URLs
   * @throws {@link QRCodeError} When JWS contains invalid characters or chunking constraints are violated
   */
  async generateQR(jws: string): Promise<string[]> {
    // Check chunking based on JWS length first
    const needsChunking = jws.length > this.config.maxSingleQRSize
    if (!this.config.enableChunking && needsChunking) {
      throw new QRCodeError(
        `Chunking is not enabled, but JWS length exceeds maxSingleQRSize:
        ${jws.length} > ${this.config.maxSingleQRSize}. Use enableChunking: true to enable chunking.`
      )
    }

    if (needsChunking) {
      // Chunk JWS first, then convert each chunk to numeric
      return await this.generateChunkedQR(jws)
    } else {
      // Convert JWS to SMART Health Cards numeric format for single QR
      const numericData = this.encodeJWSToNumeric(jws)
      return await this.generateSingleQR(numericData)
    }
  }

  /**
   * Reconstructs JWS from QR code data.
   *
   * @param qrCodeData - Array of QR code numeric strings
   * @returns Promise resolving to reconstructed JWS string
   * @throws {@link QRCodeError} When QR code data is missing or malformed
   */
  async decodeQR(qrCodeData: string[]): Promise<string> {
    if (!qrCodeData || qrCodeData.length === 0) {
      throw new QRCodeError('No QR code data provided')
    }

    // Handle single QR code
    if (qrCodeData.length === 1) {
      const firstQRData = qrCodeData[0]
      if (!firstQRData) {
        throw new QRCodeError('QR code data is undefined')
      }
      return this.decodeSingleQR(firstQRData)
    }

    // Handle chunked QR codes
    return this.decodeChunkedQR(qrCodeData)
  }

  /**
   * Converts JWS to SMART Health Cards numeric format.
   *
   * @param jws - JWS string to convert
   * @returns Numeric string representation
   * @throws {@link QRCodeError} When JWS contains non-base64url characters
   */
  public encodeJWSToNumeric(jws: string): string {
    const b64Offset = '-'.charCodeAt(0) // 45

    return jws
      .split('')
      .map(char => {
        const ascii = char.charCodeAt(0)
        const numericValue = ascii - b64Offset

        // Validate that the character is in the expected base64url range
        if (numericValue < 0 || numericValue > 77) {
          throw new QRCodeError(
            `Invalid character '${char}' in JWS. Expected base64url characters only.`
          )
        }

        // Zero-pad to 2 digits
        return numericValue.toString().padStart(2, '0')
      })
      .join('')
  }

  /**
   * Generates a single QR code with multi-segment encoding per SMART Health Cards spec
   */
  private async generateSingleQR(numericData: string): Promise<string[]> {
    const QRCode = await import('qrcode')

    // Create multi-segment encoding per SMART Health Cards specification:
    // Segment 1: Bytes mode for "shc:/" prefix
    // Segment 2: Numeric mode for JWS numeric data
    const segments = [
      { data: new TextEncoder().encode('shc:/'), mode: 'byte' as const },
      { data: numericData, mode: 'numeric' as const },
    ]

    // Generate QR code as data URL using the qrcode library
    const qrDataUrl: string = await QRCode.toDataURL(segments, this.config.encodeOptions)

    return [qrDataUrl]
  }

  /**
   * Splits JWS into balanced chunks for multi-QR encoding.
   *
   * @param jws - JWS string to chunk
   * @returns Array of chunked QR code strings in SMART Health Cards format
   */
  public chunkJWS(jws: string): string[] {
    if (!jws || typeof jws !== 'string') {
      throw new QRCodeError('Invalid JWS: must be a non-empty string')
    }

    const maxJWSChunkSize = this.config.maxSingleQRSize

    // If JWS fits in a single chunk, return it as a properly formatted QR code string
    if (jws.length <= maxJWSChunkSize) {
      const numericData = this.encodeJWSToNumeric(jws)
      return [`shc:/${numericData}`]
    }

    // Calculate balanced chunk size
    const chunkCount = Math.ceil(jws.length / maxJWSChunkSize)
    const balancedChunkSize = Math.ceil(jws.length / chunkCount)

    // Split JWS into balanced chunks
    const jwsChunks: string[] = []
    for (let i = 0, chunkIndex = 1; i < jws.length; i += balancedChunkSize, chunkIndex++) {
      const chunk = jws.substring(i, i + balancedChunkSize)
      const chunkNumeric = this.encodeJWSToNumeric(chunk)
      jwsChunks.push(`shc:/${chunkIndex}/${chunkCount}/${chunkNumeric}`)
    }

    return jwsChunks
  }

  /**
   * Generates chunked QR codes with multi-segment encoding (deprecated but supported for compatibility)
   */
  private async generateChunkedQR(jws: string): Promise<string[]> {
    const QRCode = await import('qrcode')

    // Use the public chunking method to split JWS
    const jwsChunks = this.chunkJWS(jws)
    const totalChunks = jwsChunks.length
    const qrDataUrls: string[] = []

    // Generate QR code for each chunk
    for (let i = 0; i < jwsChunks.length; i++) {
      const chunkIndex = i + 1 // 1-based indexing
      const jwsChunk = jwsChunks[i] as string
      const numericData = jwsChunk.split('/').pop() as string

      // Create multi-segment encoding per SMART Health Cards specification:
      // Segment 1: Bytes mode for "shc:/{index}/{total}/" prefix
      // Segment 2: Numeric mode for chunk numeric data
      const chunkPrefix = `shc:/${chunkIndex}/${totalChunks}/`
      const segments = [
        { data: new TextEncoder().encode(chunkPrefix), mode: 'byte' as const },
        { data: numericData, mode: 'numeric' as const },
      ]

      // Generate QR code as data URL using the qrcode library
      const qrDataUrl: string = await QRCode.toDataURL(segments, this.config.encodeOptions)
      qrDataUrls.push(qrDataUrl)
    }

    return qrDataUrls
  }

  /**
   * Decodes a single QR code from SMART Health Cards format
   * @throws {@link QRCodeError} When prefix is invalid
   */
  private decodeSingleQR(qrData: string): string {
    // Remove shc:/ prefix
    const prefix = 'shc:/'
    if (!qrData.startsWith(prefix)) {
      throw new QRCodeError(`Invalid QR code format. Expected '${prefix}' prefix.`)
    }

    const numericData = qrData.substring(prefix.length)
    return this.decodeNumericToJWS(numericData)
  }

  /**
   * Decodes chunked QR codes and reconstructs the original JWS
   * @throws {@link QRCodeError} When chunk indices/totals are invalid or parts are missing
   */
  private decodeChunkedQR(qrDataArray: string[]): string {
    const chunks: { index: number; data: string }[] = []
    let totalChunks = 0

    // Parse each QR code chunk
    for (const qrData of qrDataArray) {
      const prefix = 'shc:/'
      if (!qrData.startsWith(prefix)) {
        throw new QRCodeError(`Invalid chunked QR code format. Expected '${prefix}' prefix.`)
      }

      const content = qrData.substring(prefix.length)
      const parts = content.split('/')

      if (parts.length !== 3) {
        throw new QRCodeError(
          'Invalid chunked QR code format. Expected format: shc:/INDEX/TOTAL/DATA'
        )
      }

      const chunkIndexStr = parts[0]
      const chunkTotalStr = parts[1]
      const chunkData = parts[2]

      if (!chunkIndexStr || !chunkTotalStr || !chunkData) {
        throw new QRCodeError('Invalid chunked QR code format: missing parts')
      }

      const chunkIndex = parseInt(chunkIndexStr)
      const chunkTotal = parseInt(chunkTotalStr)

      if (
        Number.isNaN(chunkIndex) ||
        Number.isNaN(chunkTotal) ||
        chunkIndex < 1 ||
        chunkIndex > chunkTotal
      ) {
        throw new QRCodeError('Invalid chunk index or total in QR code')
      }

      if (totalChunks === 0) {
        totalChunks = chunkTotal
      } else if (totalChunks !== chunkTotal) {
        throw new QRCodeError('Inconsistent total chunk count across QR codes')
      }

      chunks.push({ index: chunkIndex, data: chunkData })
    }

    // Validate we have all chunks
    if (chunks.length !== totalChunks) {
      throw new QRCodeError(`Missing chunks. Expected ${totalChunks}, got ${chunks.length}`)
    }

    // Sort chunks by index and reconstruct numeric data
    chunks.sort((a, b) => a.index - b.index)
    const numericData = chunks.map(chunk => chunk.data).join('')

    return this.decodeNumericToJWS(numericData)
  }

  /**
   * Converts numeric data back to JWS string.
   *
   * @param numericData - Numeric string to decode
   * @returns Decoded JWS string
   * @throws {@link QRCodeError} When numeric data is malformed or out of range
   */
  public decodeNumericToJWS(numericData: string): string {
    // Validate even length
    if (numericData.length % 2 !== 0) {
      throw new QRCodeError('Invalid numeric data: must have even length')
    }

    const b64Offset = '-'.charCodeAt(0) // 45
    const digitPairs = numericData.match(/(\d\d)/g)

    if (!digitPairs) {
      throw new QRCodeError('Invalid numeric data: cannot parse digit pairs')
    }

    // Validate each pair is within valid range (0-77)
    for (const pair of digitPairs) {
      const value = parseInt(pair)
      if (value > 77) {
        throw new QRCodeError(`Invalid digit pair '${pair}': value ${value} exceeds maximum 77`)
      }
    }

    // Convert digit pairs back to characters
    return digitPairs
      .map(pair => {
        const numericValue = parseInt(pair)
        const asciiCode = numericValue + b64Offset
        return String.fromCharCode(asciiCode)
      })
      .join('')
  }
}
