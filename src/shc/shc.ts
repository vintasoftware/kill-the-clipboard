// SmartHealthCard class

import { FHIRBundleProcessor } from './fhir/bundle-processor.js'
import { QRCodeGenerator } from './qr/qr-code-generator.js'
import type { FHIRBundle, QRCodeConfigParams } from './types.js'

/**
 * Represents an issued SMART Health Card with various output formats.
 * This is the main user-facing object that provides different ways to export the health card.
 *
 * @public
 * @group SHC
 * @category High-Level API
 */
export class SmartHealthCard {
  constructor(
    private readonly jws: string,
    private readonly originalBundle: FHIRBundle
  ) {}

  /**
   * Returns the raw JWS string.
   *
   * @returns The JWS string
   */
  asJWS(): string {
    return this.jws
  }

  /**
   * Returns the original FHIR Bundle (unoptimized).
   *
   * @returns The original FHIR Bundle
   */
  getOriginalBundle(): FHIRBundle {
    return this.originalBundle
  }

  /**
   * Generate QR code data URLs from the health card.
   *
   * @param config - Optional QR code configuration parameters. See {@link QRCodeConfigParams}.
   * @returns Promise resolving to array of QR code data URLs
   * @throws {@link QRCodeError} When JWS contains invalid characters or chunking is required but disabled
   *
   * @example
   * ```typescript
   * const qrCodes = await healthCard.asQR({
   *   enableChunking: false,
   *   encodeOptions: {
   *     errorCorrectionLevel: 'L',
   *     scale: 4
   *   }
   * });
   * ```
   */
  async asQR(config: QRCodeConfigParams = {}): Promise<string[]> {
    const qrGenerator = new QRCodeGenerator(config)
    return await qrGenerator.generateQR(this.jws)
  }

  /**
   * Generate QR numeric strings from the health card.
   *
   * @param config - Optional QR code configuration parameters. See {@link QRCodeConfigParams}.
   * @returns Array of QR numeric strings in SMART Health Cards format (`shc:/...`)
   * @throws {@link QRCodeError} When JWS contains invalid characters
   *
   * @example
   * ```typescript
   * const qrNumericStrings = healthCard.asQRNumeric();
   * console.log(qrNumericStrings[0]); // "shc:/567629595326546034602925..."
   *
   * // With chunking for large health cards
   * const chunkedStrings = healthCard.asQRNumeric({
   *   enableChunking: true,
   *   maxSingleQRSize: 500
   * });
   * ```
   */
  asQRNumeric(config: QRCodeConfigParams = {}): string[] {
    const qrGenerator = new QRCodeGenerator(config)
    return qrGenerator.chunkJWS(this.jws)
  }

  /**
   * Return the FHIR Bundle from the health card.
   *
   * @param config.optimizeForQR - Whether to optimize the FHIR Bundle for QR code optimization
   * @param config.strictReferences - Whether to enforce strict reference validation during QR optimization
   * @returns Promise resolving to FHIR Bundle
   * @throws {@link InvalidBundleReferenceError} If `optimizeForQR` is true and a reference target is missing when `strictReferences` is true
   * @throws {@link FHIRValidationError} If the bundle fails validation during QR optimization
   */
  async asBundle(
    config: { optimizeForQR?: boolean; strictReferences?: boolean } = {}
  ): Promise<FHIRBundle> {
    const { optimizeForQR = false, strictReferences = true } = config
    if (optimizeForQR) {
      const fhirProcessor = new FHIRBundleProcessor()
      return fhirProcessor.processForQR(this.originalBundle, { strictReferences })
    }
    return this.originalBundle
  }

  /**
   * Return JSON file content for .smart-health-card files.
   *
   * @returns Promise resolving to JSON string with verifiableCredential array
   */
  async asFileContent(): Promise<string> {
    const fileContent = {
      verifiableCredential: [this.jws],
    }
    return JSON.stringify(fileContent)
  }

  /**
   * Return downloadable Blob with correct MIME type.
   *
   * @returns Promise resolving to Blob with `application/smart-health-card` MIME type
   */
  async asFileBlob(): Promise<Blob> {
    const fileContent = await this.asFileContent()
    return new Blob([fileContent], {
      type: 'application/smart-health-card',
    })
  }
}
