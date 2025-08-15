// Core Smart Health Cards Library
// Implementation of SMART Health Cards Framework specification
// https://spec.smarthealth.cards/

import type { Bundle } from '@medplum/fhirtypes'

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
 * FHIR R4 Bundle type re-exported from @medplum/fhirtypes for convenience.
 *
 * @public
 * @category Types
 */
export type FHIRBundle = Bundle

/**
 * Verifiable Credential structure for SMART Health Cards.
 *
 * @public
 * @category Types
 */
export interface VerifiableCredential {
  /** The verifiable credential content. */
  vc: {
    /** Array of credential types, must include 'https://smarthealth.cards#health-card'. */
    type: string[]
    /** The credential subject containing FHIR data. */
    credentialSubject: {
      /** FHIR version in semantic version format (e.g., '4.0.1'). */
      fhirVersion: string
      /** The FHIR Bundle containing medical data. */
      fhirBundle: FHIRBundle
    }
  }
}

/**
 * JWT payload structure for SMART Health Cards.
 *
 * @public
 * @category Types
 */
export interface SmartHealthCardJWT {
  /** Issuer URL identifying the organization. */
  iss: string
  /** Not before timestamp (Unix timestamp). */
  nbf: number
  /** Optional expiration timestamp (Unix timestamp). */
  exp?: number
  /** The verifiable credential content. */
  vc: VerifiableCredential['vc']
}

// Error Classes
/**
 * Base error class for SMART Health Card operations.
 *
 * @public
 * @category Errors
 */
export class SmartHealthCardError extends Error {
  constructor(
    message: string,
    /** Error code for programmatic handling. */
    public readonly code: string
  ) {
    super(message)
    this.name = 'SmartHealthCardError'
  }
}

/**
 * Error thrown when FHIR Bundle validation fails.
 *
 * @public
 * @category Errors
 */
export class FhirValidationError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'FHIR_VALIDATION_ERROR')
    this.name = 'FhirValidationError'
  }
}

/**
 * Error thrown when JWT/JWS processing fails.
 *
 * @public
 * @category Errors
 */
export class JWSError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'JWS_ERROR')
    this.name = 'JWSError'
  }
}

/**
 * Error thrown when QR code processing fails.
 *
 * @public
 * @category Errors
 */
export class QRCodeError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'QR_CODE_ERROR')
    this.name = 'QRCodeError'
  }
}

/**
 * Error thrown when a bundle reference cannot be resolved.
 *
 * @public
 * @category Errors
 */
export class InvalidBundleReferenceError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'INVALID_BUNDLE_REFERENCE_ERROR')
    this.name = 'InvalidBundleReferenceError'
  }
}

/**
 * Error thrown when file format is invalid or cannot be parsed.
 *
 * @public
 * @category Errors
 */
export class FileFormatError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'FILE_FORMAT_ERROR')
    this.name = 'FileFormatError'
  }
}

/**
 * Error thrown when SMART Health Card verification fails unexpectedly.
 *
 * @public
 * @category Errors
 */
export class VerificationError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'VERIFICATION_ERROR')
    this.name = 'VerificationError'
  }
}

// Configuration Interfaces
/**
 * Configuration parameters for SmartHealthCardIssuer.
 *
 * @public
 * @category Configuration
 */
export interface SmartHealthCardConfigParams {
  /**
   * Issuer URL identifying the organization issuing the health card.
   * This value appears in the JWT `iss` claim.
   */
  issuer: string

  /**
   * ES256 private key for signing health cards.
   * Can be a WebCrypto CryptoKey, raw bytes as Uint8Array, or PEM-formatted string.
   */
  privateKey: CryptoKey | Uint8Array | string

  /**
   * ES256 public key corresponding to the private key.
   * Used for key ID (`kid`) derivation per SMART Health Cards specification.
   */
  publicKey: CryptoKey | Uint8Array | string

  /**
   * Optional expiration time in seconds from now.
   * If `null`, health cards will not have an expiration (`exp` claim).
   * @defaultValue `null`
   */
  expirationTime?: number | null

  /**
   * Whether to optimize FHIR Bundle for QR codes by using short resource-scheme URIs
   * (`resource:0`, `resource:1`, etc.) and removing unnecessary fields.
   * @defaultValue `true`
   */
  enableQROptimization?: boolean

  /**
   * Whether to enforce strict reference validation during QR optimization.
   * If `true`, throws error for missing bundle references.
   * If `false`, preserves original references when target resource is not found.
   * @defaultValue `true`
   */
  strictReferences?: boolean
}

/**
 * @category Configuration
 */
export type SmartHealthCardConfig = Required<SmartHealthCardConfigParams>

/**
 * Configuration parameters for SmartHealthCardReader.
 * Reader configuration only needs public key for verification.
 *
 * @public
 * @category Configuration
 */
export interface SmartHealthCardReaderConfigParams {
  /**
   * ES256 public key for verifying health card signatures.
   * Can be a WebCrypto CryptoKey, raw bytes as Uint8Array, or PEM-formatted string.
   */
  publicKey: CryptoKey | Uint8Array | string

  /**
   * Whether to optimize FHIR Bundle for QR codes when reading health cards.
   * Should match the issuer's setting for proper reconstruction.
   * @defaultValue `true`
   */
  enableQROptimization?: boolean

  /**
   * Whether to enforce strict reference validation during optimization.
   * Should match the issuer's setting for proper reconstruction.
   * @defaultValue `true`
   */
  strictReferences?: boolean
}

/**
 * @category Configuration
 */
export type SmartHealthCardReaderConfig = Required<SmartHealthCardReaderConfigParams>

/**
 * Parameters for creating Verifiable Credentials.
 *
 * @public
 * @category Configuration
 */
export interface VerifiableCredentialParams {
  /**
   * FHIR version string in semantic version format (e.g., '4.0.1').
   * @defaultValue `'4.0.1'`
   */
  fhirVersion?: string

  /**
   * Array of additional Verifiable Credential type URIs to include beyond
   * the standard `https://smarthealth.cards#health-card`.
   *
   * Common values:
   * - `https://smarthealth.cards#immunization`
   * - `https://smarthealth.cards#covid19`
   * - `https://smarthealth.cards#laboratory`
   */
  includeAdditionalTypes?: string[]
}

/**
 * Additional QR encoding parameters that can be passed to the qrcode library.
 * This interface matches the expected qrcode library params.
 *
 * @public
 * @category Configuration
 */
export interface QREncodeParams {
  /**
   * Error correction level per SMART Health Cards specification:
   * - **L (Low)**: ~7% error resistance, 1195 max characters (V22)
   * - **M (Medium)**: ~15% error resistance, 927 max characters (V22)
   * - **Q (Quartile)**: ~25% error resistance, 670 max characters (V22)
   * - **H (High)**: ~30% error resistance, 519 max characters (V22)
   * @defaultValue `'L'`
   */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'

  /**
   * QR code version determining symbol size.
   * Version 1 is 21x21 modules, Version 2 is 25x25, etc.
   * Auto-selected by default based on data size.
   * @remarks Range: 1-40
   */
  version?: number

  /**
   * Mask pattern used to mask the QR code symbol.
   * Auto-selected by default for optimal readability.
   * @remarks Range: 0-7
   */
  maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

  /**
   * Quiet zone size (border) around the QR code in modules.
   * @defaultValue `1`
   */
  margin?: number

  /**
   * Scale factor for output image. A value of 1 means 1 pixel per module.
   * @defaultValue `4`
   */
  scale?: number

  /**
   * Forces specific width for output image in pixels.
   * Takes precedence over `scale` if specified.
   */
  width?: number

  /** Color configuration for QR code modules. */
  color?: {
    /**
     * Color of dark modules in hex RGBA format (e.g., '#000000ff' for black).
     * @defaultValue `'#000000ff'`
     */
    dark?: string

    /**
     * Color of light modules in hex RGBA format (e.g., '#ffffffff' for white).
     * @defaultValue `'#ffffffff'`
     */
    light?: string
  }
}

/**
 * Configuration parameters for QR code generation.
 *
 * @public
 * @category Configuration
 */
export interface QRCodeConfigParams {
  /**
   * Maximum JWS character length for single QR code.
   * Auto-derived from `errorCorrectionLevel` if not provided:
   * - L: 1195 characters
   * - M: 927 characters
   * - Q: 670 characters
   * - H: 519 characters
   *
   * Based on Version 22 QR code limits from
   * {@link https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md | SMART Health Cards QR FAQ}.
   */
  maxSingleQRSize?: number

  /**
   * Whether to support multi-chunk QR codes.
   * Note that chunked QR codes are deprecated per SMART Health Cards specification,
   * but supported for compatibility.
   * @defaultValue `false`
   */
  enableChunking?: boolean

  /** Options passed to the underlying QR code encoder. */
  encodeOptions?: QREncodeParams
}

/**
 * @category Configuration
 */
export type QRCodeConfig = Required<QRCodeConfigParams>

// Core Classes

/**
 * Represents an issued SMART Health Card with various output formats.
 * This is the main user-facing object that provides different ways to export the health card.
 *
 * @public
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
   * @param config - Optional QR code configuration parameters
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
   * @param config - Optional QR code configuration parameters
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
   * @param optimizeForQR - Whether to apply QR code optimizations to the bundle
   * @param strictReferences - Whether to enforce strict reference validation when optimizing
   * @returns Promise resolving to FHIR Bundle
   * @throws {@link InvalidBundleReferenceError} If `optimizeForQR` is true and a reference target is missing when `strictReferences` is true
   * @throws {@link FhirValidationError} If the bundle fails validation during QR optimization
   */
  async asBundle(optimizeForQR?: boolean, strictReferences?: boolean): Promise<FHIRBundle> {
    if (optimizeForQR) {
      const fhirProcessor = new FHIRBundleProcessor()
      return fhirProcessor.processForQR(this.originalBundle, strictReferences ?? true)
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

/**
 * Issues new SMART Health Cards from FHIR Bundles.
 *
 * **Security Warning**: Issue/sign on a secure backend only; never expose the private key in browsers.
 *
 * @public
 * @category High-Level API
 */
export class SmartHealthCardIssuer {
  private config: SmartHealthCardConfig
  private fhirProcessor: FHIRBundleProcessor
  private vcProcessor: VerifiableCredentialProcessor
  private jwsProcessor: JWSProcessor

  /**
   * Creates a new SmartHealthCardIssuer instance.
   *
   * @param config - Configuration parameters for the issuer
   *
   * @example
   * ```typescript
   * const issuer = new SmartHealthCardIssuer({
   *   issuer: 'https://your-healthcare-org.com',
   *   privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
   *   publicKey: publicKeySPKIString,     // ES256 public key in SPKI format
   * });
   * ```
   */
  constructor(config: SmartHealthCardConfigParams) {
    this.config = {
      ...config,
      expirationTime: config.expirationTime ?? null,
      enableQROptimization: config.enableQROptimization ?? true,
      strictReferences: config.strictReferences ?? true,
    }

    this.fhirProcessor = new FHIRBundleProcessor()
    this.vcProcessor = new VerifiableCredentialProcessor()
    this.jwsProcessor = new JWSProcessor()
  }

  /**
   * Issues a new SMART Health Card from a FHIR Bundle.
   *
   * @param fhirBundle - FHIR R4 Bundle containing medical data
   * @param options - Optional Verifiable Credential parameters
   * @returns Promise resolving to SmartHealthCard object
   * @throws {@link FhirValidationError} When FHIR bundle or VC structure is invalid
   * @throws {@link JWSError} When signing fails
   *
   * @example
   * ```typescript
   * const issuer = new SmartHealthCardIssuer(config);
   * const healthCard = await issuer.issue(fhirBundle, {
   *   includeAdditionalTypes: ['https://smarthealth.cards#covid19']
   * });
   * ```
   */
  async issue(
    fhirBundle: FHIRBundle,
    options: VerifiableCredentialParams = {}
  ): Promise<SmartHealthCard> {
    const jws = await this.createJWS(fhirBundle, options)
    return new SmartHealthCard(jws, fhirBundle)
  }

  /**
   * Internal method to create JWS from FHIR Bundle
   */
  private async createJWS(
    fhirBundle: FHIRBundle,
    vcOptions: VerifiableCredentialParams = {}
  ): Promise<string> {
    // Step 1: Process and validate FHIR Bundle
    const processedBundle = this.config.enableQROptimization
      ? this.fhirProcessor.processForQR(fhirBundle, this.config.strictReferences)
      : this.fhirProcessor.process(fhirBundle)
    this.fhirProcessor.validate(processedBundle)

    // Step 2: Create Verifiable Credential
    const vc = this.vcProcessor.create(processedBundle, vcOptions)
    this.vcProcessor.validate(vc)

    // Step 3: Create JWT payload with issuer information
    const now = Math.floor(Date.now() / 1000)
    const jwtPayload: SmartHealthCardJWT = {
      iss: this.config.issuer,
      nbf: now,
      vc: vc.vc,
    }

    // Add expiration if configured
    if (this.config.expirationTime) {
      jwtPayload.exp = now + this.config.expirationTime
    }

    // Step 4: Sign the JWT to create JWS (with compression)
    const jws = await this.jwsProcessor.sign(
      jwtPayload,
      this.config.privateKey,
      this.config.publicKey,
      true // Enable compression per SMART Health Cards spec
    )

    return jws
  }
}

/**
 * Reads and verifies SMART Health Cards from various sources.
 *
 * @public
 * @category High-Level API
 */
export class SmartHealthCardReader {
  private config: SmartHealthCardReaderConfig
  private vcProcessor: VerifiableCredentialProcessor
  private jwsProcessor: JWSProcessor

  /**
   * Creates a new SmartHealthCardReader instance.
   *
   * @param config - Configuration parameters for the reader
   *
   * @example
   * ```typescript
   * const reader = new SmartHealthCardReader({
   *   publicKey: publicKeySPKIString,     // ES256 public key in SPKI format
   * });
   * ```
   */
  constructor(config: SmartHealthCardReaderConfigParams) {
    this.config = {
      ...config,
      enableQROptimization: config.enableQROptimization ?? true,
      strictReferences: config.strictReferences ?? true,
    }

    this.vcProcessor = new VerifiableCredentialProcessor()
    this.jwsProcessor = new JWSProcessor()
  }

  /**
   * Read and verify a SMART Health Card from file content.
   *
   * @param fileContent - File content as string or Blob from .smart-health-card files
   * @returns Promise resolving to verified SmartHealthCard object
   * @throws {@link FileFormatError} If the file is not valid JSON or missing the `verifiableCredential` array
   * @throws {@link JWSError} If the embedded JWS is malformed or signature verification fails (propagated from {@link fromJWS})
   * @throws {@link FhirValidationError} If the decoded VC payload or embedded FHIR Bundle is invalid (propagated from {@link fromJWS})
   * @throws {@link VerificationError} For unexpected errors during verification (propagated from {@link fromJWS})
   */
  async fromFileContent(fileContent: string | Blob): Promise<SmartHealthCard> {
    let contentString: string

    if (fileContent instanceof Blob) {
      // Read text from Blob
      contentString = await fileContent.text()
    } else {
      contentString = fileContent
    }

    // Parse the JWS content
    const contentToParse = contentString
    let jws: string

    try {
      // Try to parse as JSON wrapper format first
      const parsed = JSON.parse(contentToParse)

      if (parsed.verifiableCredential && Array.isArray(parsed.verifiableCredential)) {
        // New JSON wrapper format
        if (parsed.verifiableCredential.length === 0) {
          throw new FileFormatError('File contains empty verifiableCredential array')
        }
        jws = parsed.verifiableCredential[0]
      } else {
        throw new FileFormatError('File does not contain expected verifiableCredential array')
      }
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FileFormatError(
        `Invalid file format - expected JSON with verifiableCredential array: ${errorMessage}`
      )
    }

    // Verify and return SmartHealthCard object
    return await this.fromJWS(jws)
  }

  /**
   * Read and verify a SMART Health Card JWS.
   *
   * @param jws - JWS string to verify
   * @returns Promise resolving to verified SmartHealthCard object
   * @throws {@link JWSError} If the JWS is malformed, signature verification fails, or the public key cannot be imported
   * @throws {@link FhirValidationError} If the decoded VC payload or embedded FHIR Bundle is invalid
   * @throws {@link VerificationError} For unexpected errors during verification
   */
  async fromJWS(jws: string): Promise<SmartHealthCard> {
    try {
      // Step 1: Verify JWS signature and extract payload (decompression handled automatically)
      const payload = await this.jwsProcessor.verify(jws, this.config.publicKey)

      // Step 2: Validate the VC
      const vc: VerifiableCredential = { vc: payload.vc }
      this.vcProcessor.validate(vc)

      // Step 3: Extract and return the original FHIR Bundle
      const originalBundle = vc.vc.credentialSubject.fhirBundle

      return new SmartHealthCard(jws, originalBundle)
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new VerificationError(`Failed to verify SMART Health Card: ${errorMessage}`)
    }
  }

  /**
   * Read and verify a SMART Health Card from QR numeric data.
   *
   * @param qrNumeric - Single QR code numeric string (format: `shc:/...`)
   * @returns Promise resolving to verified SmartHealthCard object
   * @throws {@link QRCodeError} If the QR numeric string is malformed, contains out-of-range digit pairs, or decoding fails
   * @throws {@link JWSError} If the reconstructed JWS is malformed or signature verification fails (propagated from {@link fromJWS})
   * @throws {@link FhirValidationError} If the decoded VC payload or embedded FHIR Bundle is invalid (propagated from {@link fromJWS})
   * @throws {@link VerificationError} For unexpected errors during verification (propagated from {@link fromJWS})
   *
   * @example
   * ```typescript
   * // Single QR code
   * const qrNumeric = 'shc:/56762959532654603460292540772804336028...';
   * const healthCard = await reader.fromQRNumeric(qrNumeric);
   * ```
   */
  async fromQRNumeric(qrNumeric: string): Promise<SmartHealthCard>

  /**
   * Read and verify a SMART Health Card from chunked QR numeric data.
   *
   * @param qrNumericChunks - Array of chunked QR code numeric strings (format: `shc:/index/total/...`)
   * @returns Promise resolving to verified SmartHealthCard object
   * @throws {@link QRCodeError} If any chunk has invalid prefix, index/total, missing parts, out-of-range digit pairs, or decoding fails
   * @throws {@link JWSError} If the reconstructed JWS is malformed or signature verification fails (propagated from {@link fromJWS})
   * @throws {@link FhirValidationError} If the decoded VC payload or embedded FHIR Bundle is invalid (propagated from {@link fromJWS})
   * @throws {@link VerificationError} For unexpected errors during verification (propagated from {@link fromJWS})
   *
   * @example
   * ```typescript
   * // Chunked QR codes
   * const chunkedQR = [
   *   'shc:/1/2/567629595326546034602925',
   *   'shc:/2/2/407728043360287028647167'
   * ];
   * const healthCard = await reader.fromQRNumeric(chunkedQR);
   * ```
   */
  async fromQRNumeric(qrNumericChunks: string[]): Promise<SmartHealthCard>

  /** @internal */
  async fromQRNumeric(qrData: string | string[]): Promise<SmartHealthCard> {
    try {
      // Create QR generator instance to decode the QR data
      const qrGenerator = new QRCodeGenerator()

      // Convert to array format for consistent handling
      const qrDataArray = Array.isArray(qrData) ? qrData : [qrData]

      // Decode QR data to JWS
      const jws = await qrGenerator.scanQR(qrDataArray)

      // Use existing JWS verification method
      return await this.fromJWS(jws)
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new QRCodeError(
        `Failed to read SMART Health Card from QR numeric data: ${errorMessage}`
      )
    }
  }
}

/**
 * Processes and validates FHIR R4 Bundles according to SMART Health Cards specification.
 *
 * @public
 * @category Lower-Level API
 */
export class FHIRBundleProcessor {
  /**
   * Processes a FHIR Bundle with standard processing.
   *
   * @param bundle - FHIR Bundle to process
   * @returns Processed FHIR Bundle
   * @throws {@link FhirValidationError} When bundle is not a valid FHIR Bundle
   */
  process(bundle: FHIRBundle): FHIRBundle {
    if (!bundle || bundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid bundle: must be a FHIR Bundle resource')
    }

    // Create a deep copy to avoid modifying the original
    const processedBundle: FHIRBundle = JSON.parse(JSON.stringify(bundle))

    // Ensure Bundle.type defaults to "collection" per SMART Health Cards spec
    // This is the only explicit field requirement mentioned in the spec
    if (!processedBundle.type) {
      processedBundle.type = 'collection'
    }

    return processedBundle
  }

  /**
   * Processes a FHIR Bundle with QR code optimizations (short resource-scheme URIs, removes unnecessary fields).
   *
   * @param bundle - FHIR Bundle to process
   * @param strict - When `strict` is true, missing `Reference.reference` targets throw `InvalidBundleReferenceError`;
   *                 when false, original references are preserved when no target resource is found in bundle.
   * @returns Processed FHIR Bundle optimized for QR codes
   * @throws {@link InvalidBundleReferenceError} When `strict` is true and a reference cannot be resolved
   */
  processForQR(bundle: FHIRBundle, strict: boolean): FHIRBundle {
    // Start with standard processing
    const processedBundle = this.process(bundle)

    // Apply QR optimizations
    return this.optimizeForQR(processedBundle, strict)
  }

  /**
   * Optimizes a FHIR Bundle for QR code generation
   * - Uses short resource-scheme URIs (resource:0, resource:1, etc.)
   * - Removes unnecessary .id and .display fields
   * - Removes empty arrays and null values
   */
  private optimizeForQR(bundle: FHIRBundle, strict: boolean): FHIRBundle {
    const optimizedBundle: FHIRBundle = JSON.parse(JSON.stringify(bundle))

    // Drop Bundle.id
    delete optimizedBundle.id

    // Create resource reference mapping
    const resourceMap = new Map<string, string>()

    // First pass: map fullUrl to short resource references
    if (optimizedBundle.entry) {
      optimizedBundle.entry.forEach((entry, index) => {
        if (entry.fullUrl) {
          resourceMap.set(entry.fullUrl.split('/').slice(-2).join('/'), `resource:${index}`)
          entry.fullUrl = `resource:${index}`
        }
      })

      // Second pass: optimize resources and update references
      optimizedBundle.entry.forEach(entry => {
        if (entry.resource) {
          // Recursively optimize the resource
          entry.resource = this.optimizeResource(
            entry.resource,
            resourceMap,
            strict
          ) as typeof entry.resource
        }
      })
    }

    return optimizedBundle
  }

  /**
   * Recursively optimizes a FHIR resource for QR codes
   */
  private optimizeResource(
    resource: unknown,
    resourceMap: Map<string, string>,
    strict: boolean
  ): unknown {
    if (!resource || typeof resource !== 'object') {
      return resource
    }

    if (Array.isArray(resource)) {
      return resource
        .map(item => this.optimizeResource(item, resourceMap, strict))
        .filter(item => item !== null && item !== undefined)
    }

    const optimized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(resource as Record<string, unknown>)) {
      // Skip null, undefined, and empty arrays
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
        continue
      }

      // Remove Resource.id for all resources
      if (key === 'id') {
        continue
      }

      // Handle Resource.meta - only keep meta.security if present
      if (key === 'meta') {
        if (typeof value === 'object' && value !== null) {
          const metaObj = value as Record<string, unknown>
          if (metaObj.security && Array.isArray(metaObj.security)) {
            optimized[key] = { security: metaObj.security }
          }
        }
        continue
      }

      // Remove text from DomainResource and CodeableConcept
      if (
        (key === 'text' && this.isCodeableConcept(resource)) ||
        (key === 'text' && this.isDomainResource(resource))
      ) {
        continue
      }

      // Remove .display fields from CodeableConcept.coding, but not from other contexts
      if (key === 'display' && typeof value === 'string' && this.isWithinCoding(resource)) {
        continue
      }

      // Update references to use short resource-scheme URIs
      if (key === 'reference' && typeof value === 'string') {
        const shortRef = resourceMap.get(value)
        if (shortRef) {
          // Found reference in resourceMap
          optimized[key] = shortRef
        } else {
          // Reference not found in resourceMap
          if (strict) {
            // Strict mode: raise exception for missing references
            throw new InvalidBundleReferenceError(
              `Reference "${value}" not found in bundle resources`
            )
          } else {
            // Non-strict mode: keep the original reference
            optimized[key] = value
          }
        }
        continue
      }

      // Recursively process nested objects and arrays
      optimized[key] = this.optimizeResource(value, resourceMap, strict)
    }

    return optimized
  }

  /**
   * Checks if a resource is a DomainResource
   */
  private isDomainResource(resource: unknown): boolean {
    return (
      resource != null &&
      // @ts-expect-error - ignore type error
      resource.text != null &&
      // @ts-expect-error - ignore type error
      typeof resource.text === 'object' &&
      // @ts-expect-error - ignore type error
      'div' in resource.text
    )
  }

  /**
   * Checks if a resource is a CodeableConcept
   */
  private isCodeableConcept(resource: unknown): boolean {
    return (
      resource != null &&
      typeof resource === 'object' &&
      'coding' in resource &&
      Array.isArray((resource as Record<string, unknown>).coding)
    )
  }

  /**
   * Checks if a resource is within a coding array context
   * Display fields should only be removed from coding arrays, not other contexts
   */
  private isWithinCoding(resource: unknown): boolean {
    return (
      resource !== null &&
      typeof resource === 'object' &&
      'system' in resource &&
      'code' in resource &&
      typeof (resource as Record<string, unknown>).system === 'string' &&
      typeof (resource as Record<string, unknown>).code === 'string'
    )
  }

  /**
   * Validates a FHIR Bundle for basic compliance.
   *
   * @param bundle - FHIR Bundle to validate
   * @returns `true` if validation passes
   * @throws {@link FhirValidationError} if validation fails
   */
  validate(bundle: FHIRBundle): boolean {
    try {
      // Basic structure validation
      if (!bundle) {
        throw new FhirValidationError('Bundle cannot be null or undefined')
      }

      if (bundle.resourceType !== 'Bundle') {
        throw new FhirValidationError('Resource must be of type Bundle')
      }

      // Enforce FHIR Bundle.type value set (R4) if provided
      // SHC 1.3.0 allows any FHIR Bundle.type, but it must still be one of the FHIR-defined codes
      // See: https://spec.smarthealth.cards/changelog/ (1.3.0) and https://build.fhir.org/valueset-bundle-type.html
      if (bundle.type) {
        const allowedTypes = new Set([
          'document',
          'message',
          'transaction',
          'transaction-response',
          'batch',
          'batch-response',
          'history',
          'searchset',
          'collection',
        ])
        if (!allowedTypes.has(bundle.type as string)) {
          throw new FhirValidationError(`Invalid bundle.type: ${bundle.type}`)
        }
      }

      // Validate entries if present
      if (bundle.entry) {
        if (!Array.isArray(bundle.entry)) {
          throw new FhirValidationError('Bundle.entry must be an array')
        }

        for (const [index, entry] of bundle.entry.entries()) {
          if (!entry.resource) {
            throw new FhirValidationError(`Bundle.entry[${index}] must contain a resource`)
          }

          if (!entry.resource.resourceType) {
            throw new FhirValidationError(
              `Bundle.entry[${index}].resource must have a resourceType`
            )
          }
        }
      }

      return true
    } catch (error) {
      if (error instanceof FhirValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FhirValidationError(`Bundle validation failed: ${errorMessage}`)
    }
  }
}

/**
 * Creates and validates Verifiable Credentials for SMART Health Cards.
 *
 * @public
 * @category Lower-Level API
 */
export class VerifiableCredentialProcessor {
  /**
   * Creates a Verifiable Credential from a FHIR Bundle.
   *
   * @param fhirBundle - FHIR Bundle to create credential from
   * @param options - Optional Verifiable Credential parameters
   * @returns Verifiable Credential structure
   * @throws {@link FhirValidationError} When the input bundle is invalid
   */
  create(fhirBundle: FHIRBundle, options: VerifiableCredentialParams = {}): VerifiableCredential {
    // Validate input bundle
    if (!fhirBundle || fhirBundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid FHIR Bundle provided')
    }

    // Set default FHIR version per SMART Health Cards spec
    const fhirVersion = options.fhirVersion || '4.0.1'

    // Create the standard type array per SMART Health Cards spec
    const type = this.createStandardTypes(options.includeAdditionalTypes)

    // Create the verifiable credential structure
    const vc: VerifiableCredential = {
      vc: {
        type: type,
        credentialSubject: {
          fhirVersion: fhirVersion,
          fhirBundle: fhirBundle,
        },
      },
    }

    return vc
  }

  /**
   * Validates a Verifiable Credential structure.
   *
   * @param vc - Verifiable Credential to validate
   * @returns `true` if validation passes
   * @throws {@link FhirValidationError} if validation fails
   */
  validate(vc: VerifiableCredential): boolean {
    try {
      if (!vc || !vc.vc) {
        throw new FhirValidationError('Invalid VC: missing vc property')
      }

      // Validate type array
      this.validateTypes(vc.vc.type)

      // Validate credential subject
      this.validateCredentialSubject(vc.vc.credentialSubject)

      return true
    } catch (error) {
      if (error instanceof FhirValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FhirValidationError(`VC validation failed: ${errorMessage}`)
    }
  }

  /**
   * Creates the standard type array per SMART Health Cards specification
   */
  private createStandardTypes(additionalTypes?: string[]): string[] {
    const standardTypes = ['https://smarthealth.cards#health-card']

    if (additionalTypes && additionalTypes.length > 0) {
      return [...standardTypes, ...additionalTypes]
    }

    return standardTypes
  }

  /**
   * Validates the type array
   */
  private validateTypes(types: string[]): void {
    if (!Array.isArray(types)) {
      throw new FhirValidationError('VC type must be an array')
    }

    if (types.length < 1) {
      throw new FhirValidationError('VC type must contain at least 1 element')
    }

    // Must include health-card type
    if (!types.includes('https://smarthealth.cards#health-card')) {
      throw new FhirValidationError('VC type must include https://smarthealth.cards#health-card')
    }
  }

  /**
   * Validates the credential subject
   */
  private validateCredentialSubject(credentialSubject: {
    fhirVersion: string
    fhirBundle: FHIRBundle
  }): void {
    if (!credentialSubject) {
      throw new FhirValidationError('VC credentialSubject is required')
    }

    if (!credentialSubject.fhirVersion) {
      throw new FhirValidationError('VC credentialSubject must include fhirVersion')
    }

    // Validate FHIR version format (should be semantic version)
    const fhirVersionRegex = /^\d+\.\d+\.\d+$/
    if (!fhirVersionRegex.test(credentialSubject.fhirVersion)) {
      throw new FhirValidationError(
        'VC fhirVersion must be in semantic version format (e.g., 4.0.1)'
      )
    }

    if (!credentialSubject.fhirBundle) {
      throw new FhirValidationError('VC credentialSubject must include fhirBundle')
    }

    if (credentialSubject.fhirBundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('VC fhirBundle must be a valid FHIR Bundle')
    }
  }
}

/**
 * Handles JWT/JWS signing and verification with ES256 algorithm.
 *
 * @public
 * @category Lower-Level API
 */
export class JWSProcessor {
  /**
   * Raw DEFLATE compression helper
   */
  private async deflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const { deflate } = await import('fflate')
    return new Promise<Uint8Array>((resolve, reject) => {
      // fflate.deflate is raw DEFLATE (no headers)
      deflate(data, (err: Error | null, out: Uint8Array) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  }

  /**
   * Raw DEFLATE decompression helper
   */
  private async inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const { inflate } = await import('fflate')
    return new Promise<Uint8Array>((resolve, reject) => {
      // fflate.inflate expects raw DEFLATE input
      inflate(data, (err: Error | null, out: Uint8Array) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  }

  /**
   * Signs a JWT payload using ES256 algorithm.
   *
   * @param payload - JWT payload to sign
   * @param privateKey - ES256 private key
   * @param publicKey - ES256 public key (for key ID derivation)
   * @param enableCompression - Whether to compress payload with raw DEFLATE (default: true).
   *                           When `enableCompression` is true, compresses payload before signing and sets `zip: "DEF"`.
   * @returns Promise resolving to JWS string
   * @throws {@link JWSError} When signing fails, key import fails, or payload is invalid
   */
  async sign(
    payload: SmartHealthCardJWT,
    privateKey: CryptoKey | Uint8Array | string,
    publicKey: CryptoKey | Uint8Array | string,
    enableCompression = true
  ): Promise<string> {
    try {
      const { CompactSign } = await import('jose')

      // Validate required payload fields
      this.validateJWTPayload(payload)

      // Derive kid from public key
      const kid = await this.deriveKidFromPublicKey(publicKey)

      // Protected header per SMART Health Cards
      const header: { alg: 'ES256'; kid: string; zip?: 'DEF' } = {
        alg: 'ES256',
        kid,
      }

      // Serialize payload
      const payloadJson = JSON.stringify(payload)
      const encoder = new TextEncoder()
      let payloadBytes = encoder.encode(payloadJson)

      // Compress the payload BEFORE signing using raw DEFLATE (zip: "DEF")
      if (enableCompression) {
        payloadBytes = await this.deflateRaw(payloadBytes)
        header.zip = 'DEF'
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof privateKey === 'string') {
        const { importPKCS8 } = await import('jose')
        key = await importPKCS8(privateKey, 'ES256')
      } else {
        key = privateKey
      }

      // Build compact JWS (base64url(header) + '.' + base64url(payloadBytes))
      const jws = await new CompactSign(payloadBytes).setProtectedHeader(header).sign(key)
      return jws
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS signing failed: ${errorMessage}`)
    }
  }

  /**
   * Derives RFC7638 JWK Thumbprint (base64url-encoded SHA-256) from a public key to use as kid
   */
  private async deriveKidFromPublicKey(
    publicKey: CryptoKey | Uint8Array | string
  ): Promise<string> {
    const { importSPKI, exportJWK, calculateJwkThumbprint } = await import('jose')

    let keyObj: CryptoKey | Uint8Array
    if (typeof publicKey === 'string') {
      keyObj = await importSPKI(publicKey, 'ES256')
    } else {
      keyObj = publicKey
    }

    const jwk = await exportJWK(keyObj)
    // calculateJwkThumbprint defaults to SHA-256 and returns base64url string in jose v5
    const kid = await calculateJwkThumbprint(jwk)
    return kid
  }

  /**
   * Verifies a JWS and returns the decoded payload.
   *
   * @param jws - JWS string to verify
   * @param publicKey - ES256 public key for verification
   * @returns Promise resolving to decoded JWT payload
   * @throws {@link JWSError} When verification fails or JWS is invalid
   *
   * @remarks To inspect headers without verification, use `jose.decodeProtectedHeader(jws)` from the `jose` library.
   */
  async verify(
    jws: string,
    publicKey: CryptoKey | Uint8Array | string
  ): Promise<SmartHealthCardJWT> {
    try {
      const { compactVerify } = await import('jose')

      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof publicKey === 'string') {
        const { importSPKI } = await import('jose')
        key = await importSPKI(publicKey, 'ES256')
      } else {
        key = publicKey
      }

      // Verify signature over original compact JWS
      const { payload, protectedHeader } = await compactVerify(jws, key)

      // Decompress payload if zip: 'DEF'
      let payloadBytes = payload
      if (protectedHeader.zip === 'DEF') {
        payloadBytes = await this.inflateRaw(payload)
      }

      // Parse JSON
      const payloadJson = new TextDecoder().decode(payloadBytes)
      const smartPayload = JSON.parse(payloadJson) as SmartHealthCardJWT

      // Validate structure
      this.validateJWTPayload(smartPayload)

      return smartPayload
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS verification failed: ${errorMessage}`)
    }
  }

  /**
   * Validates the structure of a SMART Health Card JWT payload
   */
  private validateJWTPayload(payload: SmartHealthCardJWT): void {
    if (!payload || typeof payload !== 'object') {
      throw new JWSError('Invalid JWT payload: must be an object')
    }

    // Validate required fields per SMART Health Cards spec
    if (!payload.iss || typeof payload.iss !== 'string') {
      throw new JWSError("Invalid JWT payload: 'iss' (issuer) is required and must be a string")
    }

    if (!payload.nbf || typeof payload.nbf !== 'number') {
      throw new JWSError("Invalid JWT payload: 'nbf' (not before) is required and must be a number")
    }

    // exp is optional but if present must be a number
    if (payload.exp !== undefined && typeof payload.exp !== 'number') {
      throw new JWSError("Invalid JWT payload: 'exp' (expiration) must be a number if provided")
    }

    // Validate exp > nbf if both are present
    if (payload.exp && payload.exp <= payload.nbf) {
      throw new JWSError("Invalid JWT payload: 'exp' must be greater than 'nbf'")
    }

    if (!payload.vc || typeof payload.vc !== 'object') {
      throw new JWSError(
        "Invalid JWT payload: 'vc' (verifiable credential) is required and must be an object"
      )
    }
  }
}

/**
 * Generates and scans QR codes for SMART Health Cards with proper numeric encoding.
 *
 * @public
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
        `Chunking is not enabled, but JWS length exceeds maxSingleQRSize: ${jws.length} > ${this.config.maxSingleQRSize}. Use enableChunking: true to enable chunking.`
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
  async scanQR(qrCodeData: string[]): Promise<string> {
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
