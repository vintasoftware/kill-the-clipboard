// Core Smart Health Cards Library
// Implementation of SMART Health Cards Framework specification
// https://spec.smarthealth.cards/

import type { Bundle, Resource } from '@medplum/fhirtypes'
import {
  base64url,
  CompactEncrypt,
  CompactSign,
  calculateJwkThumbprint,
  compactDecrypt,
  compactVerify,
  decodeProtectedHeader,
  exportJWK,
  importJWK,
  importPKCS8,
  importSPKI,
} from 'jose'

// Version 22 QR code max JWS lengths by error correction level
// Source: SMART Health Cards QR Code FAQ
// See: https://raw.githubusercontent.com/smart-on-fhir/health-cards/refs/heads/main/FAQ/qr.md
const V22_MAX_JWS_BY_EC_LEVEL = {
  L: 1195, // Low error correction
  M: 927, // Medium error correction
  Q: 670, // Quartile error correction
  H: 519, // High error correction
} as const

// =============================================================================
// Shared Compression Utilities
// =============================================================================

/**
 * Raw DEFLATE compression helper for both SHC and SHL implementations.
 * Uses browser/Node.js native CompressionStream.
 */
async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const compressedStream = readable.pipeThrough(new CompressionStream('deflate-raw'))
  const compressedBuffer = await new Response(compressedStream).arrayBuffer()
  return new Uint8Array(compressedBuffer)
}

/**
 * Raw DEFLATE decompression helper for both SHC and SHL implementations.
 * Uses browser/Node.js native DecompressionStream.
 */
async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const decompressedStream = readable.pipeThrough(new DecompressionStream('deflate-raw'))
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer()
  return new Uint8Array(decompressedBuffer)
}

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
  publicKey?: CryptoKey | Uint8Array | string | null

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

  /**
   * Whether to verify the JWT `exp` claim during verification.
   * When true (default), expired health cards will be rejected.
   * Set to false to allow expired cards to be accepted.
   * @defaultValue `true`
   */
  verifyExpiration?: boolean
}

/**
 * @category Configuration
 */
export type SmartHealthCardReaderConfig = {
  publicKey?: CryptoKey | Uint8Array | string | null
  enableQROptimization: boolean
  strictReferences: boolean
  verifyExpiration: boolean
}

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
   * @throws {@link FhirValidationError} If the bundle fails validation during QR optimization
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
   *   publicKey: publicKeySPKIString, // ES256 public key in SPKI format
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
   * @param config - Optional Verifiable Credential parameters. See {@link VerifiableCredentialParams}.
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
    config: VerifiableCredentialParams = {}
  ): Promise<SmartHealthCard> {
    const jws = await this.createJWS(fhirBundle, config)
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
      ? this.fhirProcessor.processForQR(fhirBundle, {
          strictReferences: this.config.strictReferences,
        })
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
      {
        enableCompression: true, // Enable compression per SMART Health Cards spec
      }
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
   *   publicKey: publicKeySPKIString, // ES256 public key in SPKI format
   * });
   * ```
   */
  constructor(config: SmartHealthCardReaderConfigParams) {
    this.config = {
      ...config,
      enableQROptimization: config.enableQROptimization ?? true,
      strictReferences: config.strictReferences ?? true,
      verifyExpiration: config.verifyExpiration ?? true,
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
      // Resolve public key if not provided via issuer JWKS based on JWS header/payload
      let publicKeyToUse = this.config.publicKey
      if (!publicKeyToUse) {
        publicKeyToUse = await this.resolvePublicKeyFromJWKS(jws)
      }

      // Step 1: Verify JWS signature and extract payload (decompression handled automatically)
      const payload = await this.jwsProcessor.verify(jws, publicKeyToUse, {
        verifyExpiration: this.config.verifyExpiration,
      })

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
   * Resolves the public key for a JWS using the issuer's well-known JWKS endpoint when no key is provided.
   * @throws {@link VerificationError} when the key cannot be resolved
   */
  private async resolvePublicKeyFromJWKS(jws: string): Promise<CryptoKey | Uint8Array | string> {
    try {
      // Decode without verification to obtain header.kid and payload.iss
      const { header, payload } = await this.jwsProcessor.parseUnverified(jws)

      if (!payload.iss || typeof payload.iss !== 'string') {
        throw new VerificationError("Cannot resolve JWKS: missing 'iss' in payload")
      }
      if (!header.kid || typeof header.kid !== 'string') {
        throw new VerificationError("Cannot resolve JWKS: missing 'kid' in JWS header")
      }

      // Build JWKS URL from issuer origin
      const issuerUrl = new URL(payload.iss)
      const jwksUrl = `${issuerUrl.origin}/.well-known/jwks.json`

      // Fetch JWKS
      const response = await fetch(jwksUrl)
      if (!response.ok) {
        throw new VerificationError(
          `Failed to fetch JWKS from issuer (${jwksUrl}): ${response.status} ${response.statusText}`
        )
      }
      const jwks = (await response.json()) as { keys?: Array<Record<string, unknown>> }
      if (!jwks || !Array.isArray(jwks.keys)) {
        throw new VerificationError('Invalid JWKS format: missing keys array')
      }

      // Find matching key by kid
      const matching = jwks.keys.find(k => (k as Record<string, unknown>).kid === header.kid)
      if (!matching) {
        throw new VerificationError(`No matching key found in JWKS for kid '${header.kid}'`)
      }

      // Import JWK as CryptoKey
      const cryptoKey = await importJWK(matching as JsonWebKey, 'ES256')
      return cryptoKey
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new VerificationError(`Unable to resolve public key via JWKS: ${message}`)
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
      const jws = await qrGenerator.decodeQR(qrDataArray)

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
   * @param config.strictReferences - When `strictReferences` is true,
   *  missing `Reference.reference` targets throw `InvalidBundleReferenceError`;
   *  when false, original references are preserved when no target resource is found in bundle.
   * @returns Processed FHIR Bundle optimized for QR codes
   * @throws {@link InvalidBundleReferenceError} When `strictReferences` is true and a reference cannot be resolved
   */
  processForQR(bundle: FHIRBundle, config: { strictReferences?: boolean } = {}): FHIRBundle {
    // Start with standard processing
    const processedBundle = this.process(bundle)

    // Apply QR optimizations
    return this.optimizeForQR(processedBundle, config.strictReferences ?? true)
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
   * @param config - Optional Verifiable Credential parameters. See {@link VerifiableCredentialParams}.
   * @returns Verifiable Credential structure
   * @throws {@link FhirValidationError} When the input bundle is invalid
   */
  create(fhirBundle: FHIRBundle, config: VerifiableCredentialParams = {}): VerifiableCredential {
    // Validate input bundle
    if (!fhirBundle || fhirBundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid FHIR Bundle provided')
    }

    // Set default FHIR version per SMART Health Cards spec
    const fhirVersion = config.fhirVersion || '4.0.1'

    // Create the standard type array per SMART Health Cards spec
    const type = this.createStandardTypes(config.includeAdditionalTypes)

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
   * Signs a JWT payload using ES256 algorithm.
   *
   * @param payload - JWT payload to sign
   * @param privateKey - ES256 private key
   * @param publicKey - ES256 public key (for key ID derivation)
   * @param config.enableCompression - Whether to compress payload with raw DEFLATE (default: true).
   *  When `enableCompression` is true, compresses payload before signing and sets `zip: "DEF"`.
   * @returns Promise resolving to JWS string
   * @throws {@link JWSError} When signing fails, key import fails, or payload is invalid
   */
  async sign(
    payload: SmartHealthCardJWT,
    privateKey: CryptoKey | Uint8Array | string,
    publicKey: CryptoKey | Uint8Array | string,
    config: { enableCompression?: boolean } = {}
  ): Promise<string> {
    try {
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
      const enableCompression = config.enableCompression ?? true
      if (enableCompression) {
        payloadBytes = await compressDeflateRaw(payloadBytes)
        header.zip = 'DEF'
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof privateKey === 'string') {
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
   * @param config.verifyExpiration - Whether to verify the JWT `exp` claim during verification.
   *  When true (default), expired health cards will be rejected.
   *  Set to false to allow expired cards to be accepted.
   * @returns Promise resolving to decoded JWT payload
   * @throws {@link JWSError} When verification fails or JWS is invalid
   *
   * @remarks To inspect headers without verification, use `jose.decodeProtectedHeader(jws)` from the `jose` library.
   */
  async verify(
    jws: string,
    publicKey: CryptoKey | Uint8Array | string,
    config?: { verifyExpiration?: boolean }
  ): Promise<SmartHealthCardJWT> {
    try {
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      // Import key
      let key: CryptoKey | Uint8Array
      if (typeof publicKey === 'string') {
        key = await importSPKI(publicKey, 'ES256')
      } else {
        key = publicKey
      }

      // Verify signature over original compact JWS
      const { payload, protectedHeader } = await compactVerify(jws, key)

      // Decompress payload if zip: 'DEF'
      let payloadBytes = payload
      if (protectedHeader.zip === 'DEF') {
        payloadBytes = await decompressDeflateRaw(payload)
      }

      // Parse JSON
      const payloadJson = new TextDecoder().decode(payloadBytes)
      const smartPayload = JSON.parse(payloadJson) as SmartHealthCardJWT

      // Validate structure
      this.validateJWTPayload(smartPayload)

      // Enforce expiration if present (if enabled)
      const verifyExpiration = config?.verifyExpiration ?? true
      if (verifyExpiration) {
        const nowSeconds = Math.floor(Date.now() / 1000)
        if (typeof smartPayload.exp === 'number' && smartPayload.exp < nowSeconds) {
          throw new JWSError('SMART Health Card has expired')
        }
      }

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

  /**
   * Parses a Compact JWS without verifying its signature to extract protected header and payload.
   * If the header indicates zip: 'DEF', the payload will be decompressed.
   * This is safe for metadata discovery (e.g., resolving JWKS by iss/kid) but MUST NOT be used to trust content.
   */
  async parseUnverified(
    jws: string
  ): Promise<{ header: { kid?: string; zip?: 'DEF' | string }; payload: SmartHealthCardJWT }> {
    try {
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      const parts = jws.split('.')
      if (parts.length !== 3) {
        throw new JWSError('Invalid Compact JWS')
      }

      const header = decodeProtectedHeader(jws) as { kid?: string; zip?: 'DEF' | string }

      const payloadB64u = parts[1] as string
      const payloadBytes = base64url.decode(payloadB64u)

      const decompressed =
        header.zip === 'DEF' ? await decompressDeflateRaw(payloadBytes) : payloadBytes
      const json = new TextDecoder().decode(decompressed)
      const payload = JSON.parse(json) as SmartHealthCardJWT

      return { header, payload }
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new JWSError(`Failed to parse JWS: ${message}`)
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

// =============================================================================
// Smart Health Links (SHL) Implementation
// =============================================================================

/**
 * Encrypts content as JWE Compact using A256GCM direct encryption.
 * Follows SHL specification for file encryption.
 *
 * @param params.content - Content to encrypt (string)
 * @param params.key - 32-byte encryption key (base64url-encoded)
 * @param params.contentType - MIME content type for the cty header
 * @param params.enableCompression - Whether to compress with DEFLATE before encryption
 * @returns JWE Compact serialization string
 */
async function encryptSHLFile(params: {
  content: string
  key: string
  contentType: SHLFileContentType
  enableCompression?: boolean
}): Promise<string> {
  try {
    // Convert content to bytes
    const encoder = new TextEncoder()
    let contentBytes = encoder.encode(params.content)

    // Compress if enabled
    if (params.enableCompression) {
      contentBytes = await compressDeflateRaw(contentBytes)
    }

    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Encrypt using jose CompactEncrypt
    // Note: jose library doesn't support zip header, so we handle compression manually
    const protectedHeader = {
      alg: 'dir',
      enc: 'A256GCM',
      cty: params.contentType,
    }
    const jwe = await new CompactEncrypt(contentBytes)
      .setProtectedHeader(protectedHeader)
      .encrypt(keyBytes)

    // If compression was used, we need to manually add the zip header to the JWE
    if (params.enableCompression) {
      // Parse the JWE to add the zip header
      const parts = jwe.split('.')
      if (parts.length !== 5) {
        throw new SHLError('Invalid JWE format from jose library', 'SHL_ENCRYPTION_ERROR')
      }
      const partsTuple = parts as [string, string, string, string, string]

      // Decode, modify, and re-encode the protected header
      const originalHeader = JSON.parse(new TextDecoder().decode(base64url.decode(partsTuple[0])))
      const modifiedHeader = { ...originalHeader, zip: 'DEF' }
      const newHeaderB64u = base64url.encode(
        new TextEncoder().encode(JSON.stringify(modifiedHeader))
      )

      return `${newHeaderB64u}.${partsTuple[1]}.${partsTuple[2]}.${partsTuple[3]}.${partsTuple[4]}`
    }

    return jwe
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLError(`JWE encryption failed: ${errorMessage}`, 'SHL_ENCRYPTION_ERROR')
  }
}

/**
 * Decrypts JWE Compact using A256GCM direct decryption.
 * Follows SHL specification for file decryption.
 *
 * @param params.jwe - JWE Compact serialization string
 * @param params.key - 32-byte decryption key (base64url-encoded)
 * @returns Decrypted content as string
 */
async function decryptSHLFile(params: {
  jwe: string
  key: string
}): Promise<{ content: string; contentType: string }> {
  try {
    // Decode the base64url key to raw bytes
    const keyBytes = base64url.decode(params.key)

    // Decrypt using jose compactDecrypt
    const { plaintext, protectedHeader } = await compactDecrypt(params.jwe, keyBytes)

    // Extract content type from protected header
    const contentType = protectedHeader.cty as string
    if (!contentType) {
      throw new SHLDecryptionError('Missing content type (cty) in JWE protected header')
    }

    // Decompress if zip header indicates DEFLATE compression
    let contentBytes = plaintext
    if (protectedHeader.zip === 'DEF') {
      contentBytes = await decompressDeflateRaw(plaintext)
    }

    // Convert bytes back to string
    const decoder = new TextDecoder()
    const content = decoder.decode(contentBytes)

    return { content, contentType }
  } catch (error) {
    if (error instanceof SHLError) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new SHLDecryptionError(`JWE decryption failed: ${errorMessage}`)
  }
}

/**
 * FHIR R4 Resource type re-exported from @medplum/fhirtypes for convenience.
 *
 * @public
 * @category SHL Types
 */
export type FHIRResource = Resource

/**
 * SHL flags supported by this implementation.
 *
 * @public
 * @category SHL Types
 */
export type SHLFlag = 'L' | 'P' | 'LP'

/**
 * Content types supported for SHL files.
 *
 * @public
 * @category SHL Types
 */
export type SHLFileContentType = 'application/smart-health-card' | 'application/fhir+json'

/**
 * SHLink Payload structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLinkPayloadV1 {
  /** Manifest URL for this SHLink */
  url: string
  /** Symmetric key (43 characters, base64url-encoded) */
  key: string
  /** Optional expiration time in Epoch seconds */
  exp?: number
  /** Optional flag string (concatenated single-character flags) */
  flag?: SHLFlag
  /** Optional short description (max 80 characters) */
  label?: string
  /** Optional version (defaults to 1) */
  v?: 1
}

/**
 * Manifest request structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestRequestV1 {
  /** Required recipient display string */
  recipient: string
  /** Conditional when 'P' flag is present */
  passcode?: string
  /** Optional upper bound for embedded payload sizes */
  embeddedLengthMax?: number
}

/**
 * Manifest file descriptor for embedded content.
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1EmbeddedDescriptor {
  contentType: SHLFileContentType
  /** JWE Compact serialized encrypted file */
  embedded: string
}

/**
 * Manifest file descriptor for external content.
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1LocationDescriptor {
  contentType: SHLFileContentType
  /** HTTPS URL to encrypted JWE file */
  location: string
}

/**
 * Union type for manifest file descriptors.
 *
 * @public
 * @category SHL Types
 */
export type SHLManifestFileDescriptor =
  | SHLManifestV1EmbeddedDescriptor
  | SHLManifestV1LocationDescriptor

/**
 * SHL Manifest structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1 {
  files: SHLManifestFileDescriptor[]
}

/**
 * Internal structure for encrypted files.
 *
 * @public
 * @category SHL Types
 */
export interface SHLFileJWE {
  type: SHLFileContentType
  jwe: string
}

/**
 * Serialized file metadata persisted in DB (NOT the JWE content).
 * Used to reconstruct manifest responses with fresh short-lived URLs.
 *
 * @public
 * @category SHL Types
 */
export interface SerializedSHLManifestBuilderFile {
  /** Content type. */
  type: SHLFileContentType
  /** Storage path or object key where ciphertext is persisted (for signing on demand). */
  storagePath: string
  /** Total JWE compact length, used to decide embedding vs. location quickly. */
  ciphertextLength: number
}

/**
 * Serialized builder state persisted in DB (NOT the manifest response).
 * Contains the SHL payload and file metadata for reconstructing fresh manifests.
 *
 * @public
 * @category SHL Types
 */
export interface SerializedSHLManifestBuilder {
  shl: SHLinkPayloadV1
  files: SerializedSHLManifestBuilderFile[]
}

/**
 * Resolved SHL content containing the manifest and all decrypted files.
 *
 * @public
 * @category SHL Types
 */
export interface SHLResolvedContent {
  /** The fetched manifest */
  manifest: SHLManifestV1
  /** Smart Health Cards extracted from application/smart-health-card files */
  smartHealthCards: SmartHealthCard[]
  /** FHIR resources extracted from application/fhir+json files */
  fhirResources: Resource[]
}

// SHL Error Classes

/**
 * Base error class for Smart Health Links operations.
 *
 * @public
 * @category SHL Errors
 */
export class SHLError extends Error {
  /** Error code for programmatic handling. */
  public code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SHLError'
    this.code = code
  }
}

/**
 * Error thrown when SHL manifest operations fail.
 *
 * @public
 * @category SHL Errors
 */
export class SHLManifestError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_MANIFEST_ERROR')
    this.name = 'SHLManifestError'
  }
}

/**
 * Error thrown when SHL network operations fail.
 *
 * @public
 * @category SHL Errors
 */
export class SHLNetworkError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_NETWORK_ERROR')
    this.name = 'SHLNetworkError'
  }
}

/**
 * Error thrown when SHL format parsing fails.
 *
 * @public
 * @category SHL Errors
 */
export class SHLFormatError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_FORMAT_ERROR')
    this.name = 'SHLFormatError'
  }
}

/**
 * Error thrown when SHL authentication fails.
 *
 * @public
 * @category SHL Errors
 */
export class SHLAuthError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_AUTH_ERROR')
    this.name = 'SHLAuthError'
  }
}

/**
 * Error thrown when SHL passcode is invalid.
 *
 * @public
 * @category SHL Errors
 */
export class SHLInvalidPasscodeError extends SHLAuthError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_INVALID_PASSCODE_ERROR'
    this.name = 'SHLInvalidPasscodeError'
  }
}

/**
 * Error thrown when SHL resolution fails.
 *
 * @public
 * @category SHL Errors
 */
export class SHLResolveError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_RESOLVE_ERROR')
    this.name = 'SHLResolveError'
  }
}

/**
 * Error thrown when SHL decryption fails.
 *
 * @public
 * @category SHL Errors
 */
export class SHLDecryptionError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_DECRYPTION_ERROR'
    this.name = 'SHLDecryptionError'
  }
}

/**
 * Error thrown when SHL manifest is not found.
 *
 * @public
 * @category SHL Errors
 */
export class SHLManifestNotFoundError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_MANIFEST_NOT_FOUND_ERROR'
    this.name = 'SHLManifestNotFoundError'
  }
}

/**
 * Error thrown when SHL manifest requests are rate limited.
 *
 * @public
 * @category SHL Errors
 */
export class SHLManifestRateLimitError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_RATE_LIMIT_ERROR'
    this.name = 'SHLManifestRateLimitError'
  }
}

/**
 * Error thrown when SHL has expired.
 *
 * @public
 * @category SHL Errors
 */
export class SHLExpiredError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_EXPIRED_ERROR'
    this.name = 'SHLExpiredError'
  }
}

// SHL Classes - Scaffolding Only

/**
 * Immutable SHL class representing a Smart Health Link payload and URI.
 * This class only handles the SHLink "pointer" - the payload containing url, key, flags, etc.
 * Use SHLManifestBuilder to manage the manifest and files referenced by this SHL.
 *
 * @public
 * @category SHL High-Level API
 */
export class SHL {
  private readonly _baseURL: string
  private readonly _manifestPath: string
  private readonly _key: string
  private readonly _expirationDate: Date | undefined
  private readonly _flag: SHLFlag | undefined
  private readonly _label: string | undefined
  private readonly v: 1 = 1

  /**
   * Private constructor for internal instantiation. Use SHL.generate to create new instances.
   */
  private constructor(core: {
    baseURL: string
    manifestPath: string
    key: string
    expirationDate?: Date
    flag?: SHLFlag
    label?: string
  }) {
    this._baseURL = core.baseURL
    this._manifestPath = core.manifestPath
    this._key = core.key
    this._expirationDate = core.expirationDate
    this._flag = core.flag
    this._label = core.label
  }

  /**
   * Create an immutable SHL representing a Smart Health Link payload and URI.
   * Generates manifest path and encryption symmetric key automatically.
   *
   * @param params.baseURL - Base URL for constructing manifest URLs (e.g., 'https://shl.example.org/manifests/')
   * @param params.expirationDate - Optional expiration date for the SHLink, will fill the `exp` field in the SHLink payload.
   * @param params.flag - Optional flag for the SHLink: `L` (long-term), `P` (passcode), `LP` (long-term + passcode).
   * @param params.label - Optional label that provides a short description of the data behind the SHLink. Max length of 80 chars.
   */
  static generate(params: {
    baseURL: string
    expirationDate?: Date
    flag?: SHLFlag
    label?: string
  }): SHL {
    const expirationDate = params.expirationDate
    const flag = params.flag
    const label = params.label

    // Validate label length
    if (label && label.length > 80) {
      throw new SHLFormatError('Label must be 80 characters or less')
    }

    // Generate 32 random bytes for manifest path (43 chars base64url-encoded)
    const pathEntropy = new Uint8Array(32)
    crypto.getRandomValues(pathEntropy)
    const manifestPath = `/manifests/${base64url.encode(pathEntropy)}/manifest.json`

    // Generate 32 random bytes for encryption key (43 chars base64url-encoded)
    const keyEntropy = new Uint8Array(32)
    crypto.getRandomValues(keyEntropy)
    const key = base64url.encode(keyEntropy)

    const args: {
      baseURL: string
      manifestPath: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      baseURL: params.baseURL,
      manifestPath,
      key,
    }
    if (expirationDate !== undefined) args.expirationDate = expirationDate
    if (flag !== undefined) args.flag = flag
    if (label !== undefined) args.label = label
    return new SHL(args)
  }

  /** Generate the SHLink URI respecting the "Construct a SHLink Payload" section of the spec. */
  generateSHLinkURI(): string {
    const payload = this.payload
    const payloadJson = JSON.stringify(payload)
    const payloadB64u = base64url.encode(new TextEncoder().encode(payloadJson))
    return `shlink:/${payloadB64u}`
  }

  /** Get the full manifest URL that servers must handle (POST requests as per spec). */
  get url(): string {
    return this._baseURL.replace(/\/$/, '') + this._manifestPath
  }

  /** Get the base URL used for constructing manifest URLs. */
  get baseURL(): string {
    return this._baseURL
  }

  /** Get the manifest path. */
  get manifestPath(): string {
    return this._manifestPath
  }

  /** Get the base64url-encoded encryption key for files (43 characters). */
  get key(): string {
    return this._key
  }

  /** Get the expiration date as Epoch seconds if set. */
  get exp(): number | undefined {
    return this._expirationDate ? Math.floor(this._expirationDate.getTime() / 1000) : undefined
  }

  /** Get the expiration date if set. */
  get expirationDate(): Date | undefined {
    return this._expirationDate
  }

  /** Get the SHL flags if set. */
  get flag(): SHLFlag | undefined {
    return this._flag
  }

  /** Get the label if set. */
  get label(): string | undefined {
    return this._label
  }

  /** Get the version (always 1 for v1). */
  get version(): 1 {
    return this.v
  }

  /** Check if this SHL requires a passcode (has 'P' flag). */
  get requiresPasscode(): boolean {
    return this._flag?.includes('P') ?? false
  }

  /** Check if this SHL is long-term (has 'L' flag). */
  get isLongTerm(): boolean {
    return this._flag?.includes('L') ?? false
  }

  /** Get the SHL payload object for serialization. */
  get payload(): SHLinkPayloadV1 {
    const payload: SHLinkPayloadV1 = {
      url: this.url,
      key: this.key,
      v: this.v,
    }
    if (this.exp) {
      payload.exp = this.exp
    }
    if (this._flag) {
      payload.flag = this._flag
    }
    if (this._label) {
      payload.label = this._label
    }
    return payload
  }

  /**
   * Static factory method to create an SHL from a parsed payload (for viewing purposes only).
   * This is used internally by SHLViewer to reconstruct SHL objects from URIs.
   */
  static fromPayload(payload: SHLinkPayloadV1, baseURL: string, manifestPath: string): SHL {
    const args: {
      baseURL: string
      manifestPath: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      baseURL,
      manifestPath,
      key: payload.key,
    }
    if (payload.exp !== undefined) args.expirationDate = new Date(payload.exp * 1000)
    if (payload.flag !== undefined) args.flag = payload.flag
    if (payload.label !== undefined) args.label = payload.label
    return new SHL(args)
  }

  /**
   * Static method to validate a SHLink payload structure.
   * This is used internally by SHLViewer during URI parsing.
   */
  static validatePayload(payload: unknown): asserts payload is SHLinkPayloadV1 {
    if (!payload || typeof payload !== 'object') {
      throw new SHLFormatError('Invalid SHLink payload: must be an object')
    }

    const p = payload as Record<string, unknown>

    // Required fields
    if (!p.url || typeof p.url !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: missing or invalid "url" field')
    }

    if (!p.key || typeof p.key !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: missing or invalid "key" field')
    }

    // Validate key length (should be 43 characters for base64url-encoded 32 bytes)
    if (p.key.length !== 43) {
      throw new SHLFormatError('Invalid SHLink payload: "key" field must be 43 characters')
    }

    // Optional fields validation
    if (p.exp !== undefined && (typeof p.exp !== 'number' || p.exp <= 0)) {
      throw new SHLFormatError('Invalid SHLink payload: "exp" field must be a positive number')
    }

    if (p.flag !== undefined && typeof p.flag !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: "flag" field must be a string')
    }

    if (p.label !== undefined && (typeof p.label !== 'string' || p.label.length > 80)) {
      throw new SHLFormatError(
        'Invalid SHLink payload: "label" field must be a string of 80 characters or less'
      )
    }

    if (p.v !== undefined && p.v !== 1) {
      throw new SHLFormatError('Invalid SHLink payload: unsupported version')
    }

    // Validate URL format
    try {
      new URL(p.url)
    } catch {
      throw new SHLFormatError('Invalid SHLink payload: "url" field is not a valid URL')
    }

    // Validate flag format if present
    if (p.flag && !/^[LP]+$/.test(p.flag)) {
      throw new SHLFormatError('Invalid SHLink payload: "flag" field contains invalid characters')
    }
  }
}

/**
 * Class that builds the manifest and files for a Smart Health Link.
 * This class handles file encryption and manifest building.
 *
 * Per the SHL specification, the server SHALL persist the builder state (not the manifest)
 * and generate fresh manifests with short-lived URLs on each request.
 *
 * @public
 * @category SHL High-Level API
 */
export class SHLManifestBuilder {
  private readonly _shl: SHL
  private readonly uploadFile: (
    content: string,
    contentType?: SHLFileContentType
  ) => Promise<string>
  private readonly getFileURL: (path: string) => string
  private readonly loadFile: (path: string) => Promise<string>
  private readonly _files: SerializedSHLManifestBuilderFile[] = []

  /**
   * Create a manifest builder for the given SHL.
   *
   * @param params.shl - The immutable SHL instance this builder manages
   * @param params.uploadFile - Function to upload encrypted files to the server. Returns the path segment of the file in the server to be used by `getFileURL`.
   * @param params.getFileURL - Function to get the URL of a file that is already uploaded to the server. Per spec, this URL SHALL be short-lived and intended for single use.
   * @param params.loadFile - Optional function to load encrypted file content from storage. If not provided, defaults to fetching via `getFileURL()`.
   * @param params.fetch - Optional fetch implementation for the default loadFile (defaults to global fetch).
   */
  constructor(params: {
    shl: SHL
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => string
    loadFile?: (path: string) => Promise<string>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }) {
    this._shl = params.shl
    this.uploadFile = params.uploadFile
    this.getFileURL = params.getFileURL

    // Use provided loadFile or create default implementation
    this.loadFile = params.loadFile ?? this.createDefaultLoadFile(params.fetch ?? fetch)
  }

  /**
   * Creates a default loadFile implementation that fetches files using getFileURL.
   * This is used when no custom loadFile function is provided.
   */
  private createDefaultLoadFile(
    fetchImpl: (url: string, options?: RequestInit) => Promise<Response>
  ) {
    return async (storagePath: string): Promise<string> => {
      try {
        // Get the URL for the file
        const fileURL = this.getFileURL(storagePath)

        // Fetch the file content
        const response = await fetchImpl(fileURL, {
          method: 'GET',
        })

        if (!response.ok) {
          if (response.status === 404) {
            throw new SHLManifestError(`File not found at storage path: ${storagePath}`)
          } else if (response.status === 429) {
            throw new SHLManifestRateLimitError('Too many requests to file storage')
          } else {
            throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
          }
        }

        // Return the file content as text
        return await response.text()
      } catch (error) {
        if (error instanceof SHLError) {
          throw error
        }
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new SHLNetworkError(`Failed to load file from storage: ${errorMessage}`)
      }
    }
  }

  /** Add a SMART Health Card file to the manifest. Encrypts and uploads the file as JWE to the server. */
  async addHealthCard(params: {
    /** SMART Health Card JWS string or SmartHealthCard object */
    shc: SmartHealthCard | string
    /** Optional: Enable compression (default: false, as SHC is already compressed by default) */
    enableCompression?: boolean
  }): Promise<void> {
    const jwsString = typeof params.shc === 'string' ? params.shc : params.shc.asJWS()
    const fileContent = JSON.stringify({ verifiableCredential: [jwsString] })

    const encryptedFile = await this.encryptFile({
      content: fileContent,
      type: 'application/smart-health-card',
      enableCompression: params.enableCompression ?? false,
    })

    // Upload the encrypted file and store metadata
    const storagePath = await this.uploadFile(encryptedFile.jwe, encryptedFile.type)

    this._files.push({
      type: encryptedFile.type,
      storagePath,
      ciphertextLength: encryptedFile.jwe.length,
    })
  }

  /** Add a FHIR JSON file to the manifest. Encrypts and uploads the file as JWE to the server. */
  async addFHIRResource(params: {
    /** FHIR resource object */
    content: Resource
    /** Optional: Enable compression (default: true) */
    enableCompression?: boolean
  }): Promise<void> {
    const fileContent = JSON.stringify(params.content)

    const encryptedFile = await this.encryptFile({
      content: fileContent,
      type: 'application/fhir+json',
      enableCompression: params.enableCompression ?? true,
    })

    // Upload the encrypted file and store metadata
    const storagePath = await this.uploadFile(encryptedFile.jwe, encryptedFile.type)

    this._files.push({
      type: encryptedFile.type,
      storagePath,
      ciphertextLength: encryptedFile.jwe.length,
    })
  }

  /** Get the SHL instance used by this builder. */
  get shl(): SHL {
    return this._shl
  }

  /** Get the current list of files in the manifest. */
  get files(): SerializedSHLManifestBuilderFile[] {
    return [...this._files]
  }

  /**
   * Build the manifest as JSON. Considers embedded vs location files based on size thresholds.
   * Generates fresh short-lived URLs per request as per SHL specification.
   */
  async buildManifest(params: { embeddedLengthMax?: number } = {}): Promise<SHLManifestV1> {
    const embeddedLengthMax = params.embeddedLengthMax ?? 16384 // 16 KiB default

    const manifestFiles: SHLManifestFileDescriptor[] = []

    for (const file of this._files) {
      if (file.ciphertextLength <= embeddedLengthMax) {
        // Embed the file directly - load the ciphertext from storage
        const ciphertext = await this.loadFile(file.storagePath)
        manifestFiles.push({
          contentType: file.type,
          embedded: ciphertext,
        })
      } else {
        // Reference file by location with fresh short-lived URL
        const fileURL = this.getFileURL(file.storagePath)

        manifestFiles.push({
          contentType: file.type,
          location: fileURL,
        })
      }
    }

    return { files: manifestFiles }
  }

  /**
   * Return serialized builder state for persistence (NOT SHLManifestV1).
   * Server stores this JSON in DB and reconstructs the builder on demand.
   */
  serialize(): SerializedSHLManifestBuilder {
    return {
      shl: this._shl.payload,
      files: [...this._files],
    }
  }

  /**
   * Reconstruct a builder from serialized state.
   * The baseURL and manifestPath are extracted from the serialized SHL payload.
   */
  static deserialize(params: {
    data: SerializedSHLManifestBuilder
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => string
    loadFile?: (path: string) => Promise<string>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }): SHLManifestBuilder {
    // Extract base URL and manifest path from the payload URL
    const manifestURL = new URL(params.data.shl.url)
    const baseURL = manifestURL.origin
    const manifestPath = manifestURL.pathname

    // Reconstruct the SHL instance
    const shl = SHL.fromPayload(params.data.shl, baseURL, manifestPath)

    // Create the builder
    const builder = new SHLManifestBuilder({
      shl,
      uploadFile: params.uploadFile,
      getFileURL: params.getFileURL,
      ...(params.loadFile && { loadFile: params.loadFile }),
      ...(params.fetch && { fetch: params.fetch }),
    })

    // Restore the file metadata
    builder._files.push(...params.data.files)

    return builder
  }

  /** Encrypt a file into JWE (A256GCM, zip=DEF) using the SHL's encryption key */
  private async encryptFile(params: {
    content: string
    type: SHLFileContentType
    enableCompression?: boolean
  }): Promise<SHLFileJWE> {
    const jwe = await encryptSHLFile({
      content: params.content,
      key: this._shl.key,
      contentType: params.type,
      enableCompression: params.enableCompression ?? false,
    })

    return {
      type: params.type,
      jwe,
    }
  }
}

/**
 * SHL Viewer handles parsing and resolving Smart Health Links.
 * This class processes SHLink URIs and fetches/decrypts the referenced content.
 *
 * @public
 * @category SHL High-Level API
 */
export class SHLViewer {
  private readonly _shl?: SHL
  private readonly fetchImpl: (url: string, options?: RequestInit) => Promise<Response>

  /**
   * Create an SHL viewer.
   *
   * @param params.shlinkURI - The SHLink URI to parse
   * @param params.fetch - Optional fetch implementation (defaults to global fetch)
   */
  constructor(params?: {
    shlinkURI?: string
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }) {
    this.fetchImpl = params?.fetch ?? fetch

    if (params?.shlinkURI) {
      this._shl = this.parseSHLinkURI(params.shlinkURI)
    }
  }

  /**
   * Get SHLink object from SHLink URI
   */
  get shl(): SHL {
    if (!this._shl) {
      throw new SHLFormatError('No SHLink URI provided to viewer')
    }
    return this._shl
  }

  /**
   * Resolve a SHLink URI by fetching and decrypting all referenced content.
   * Throws errors if the SHLink is invalid, expired, or the passcode is incorrect.
   *
   * @param params.passcode - Optional passcode for P-flagged SHLinks
   * @param params.recipient - Required recipient identifier for manifest requests
   * @param params.embeddedLengthMax - Optional max length for embedded content preference
   */
  async resolveSHLink(params: {
    passcode?: string
    recipient: string
    embeddedLengthMax?: number
  }): Promise<SHLResolvedContent> {
    const shl = this.shl

    // Check expiration
    if (shl.exp && shl.exp < Math.floor(Date.now() / 1000)) {
      throw new SHLExpiredError('SHL has expired')
    }

    // Validate passcode requirement
    if (shl.requiresPasscode && !params.passcode) {
      throw new SHLInvalidPasscodeError('SHL requires a passcode')
    }

    // Fetch manifest
    const manifest = await this.fetchManifest({
      url: shl.url,
      recipient: params.recipient,
      ...(params.passcode && { passcode: params.passcode }),
      ...(params.embeddedLengthMax !== undefined && {
        embeddedLengthMax: params.embeddedLengthMax,
      }),
    })

    // Process all files in the manifest
    const smartHealthCards: SmartHealthCard[] = []
    const fhirResources: Resource[] = []

    for (const fileDescriptor of manifest.files) {
      let decryptedFile: { content: string; contentType: string }

      if ('embedded' in fileDescriptor) {
        // Decrypt embedded file
        decryptedFile = await decryptSHLFile({
          jwe: fileDescriptor.embedded,
          key: shl.key,
        })
      } else {
        // Fetch and decrypt external file
        decryptedFile = await this.fetchAndDecryptFile({
          url: fileDescriptor.location,
          key: shl.key,
        })
      }

      // Verify content type matches
      if (decryptedFile.contentType !== fileDescriptor.contentType) {
        throw new SHLManifestError(
          `Content type mismatch: expected ${fileDescriptor.contentType}, got ${decryptedFile.contentType}`
        )
      }

      // Process based on content type
      if (fileDescriptor.contentType === 'application/smart-health-card') {
        // Parse SMART Health Card file
        let fileContent: { verifiableCredential: string[] }
        try {
          fileContent = JSON.parse(decryptedFile.content) as { verifiableCredential: string[] }
        } catch {
          throw new SHLManifestError('Invalid SMART Health Card file: not valid JSON')
        }

        if (!Array.isArray(fileContent.verifiableCredential)) {
          throw new SHLManifestError(
            'Invalid SMART Health Card file: missing verifiableCredential array'
          )
        }

        // Create SmartHealthCard objects for each JWS
        for (const jws of fileContent.verifiableCredential) {
          // Use SmartHealthCardReader to properly decode the JWS and extract the FHIR Bundle
          const reader = new SmartHealthCardReader({ verifyExpiration: false })
          const smartHealthCard = await reader.fromJWS(jws)
          smartHealthCards.push(smartHealthCard)
        }
      } else if (fileDescriptor.contentType === 'application/fhir+json') {
        // Parse FHIR resource
        let fhirResource: Resource
        try {
          fhirResource = JSON.parse(decryptedFile.content) as Resource
        } catch {
          throw new SHLManifestError('Invalid FHIR JSON file: not valid JSON')
        }

        if (!fhirResource.resourceType) {
          throw new SHLManifestError('Invalid FHIR JSON file: missing resourceType')
        }

        fhirResources.push(fhirResource)
      }
    }

    return {
      manifest,
      smartHealthCards,
      fhirResources,
    }
  }

  /**
   * Parse a SHLink URI into an SHL object
   */
  private parseSHLinkURI(shlinkURI: string): SHL {
    try {
      // Remove viewer prefix if present (ends with #)
      let uriToParse = shlinkURI
      const hashIndex = shlinkURI.indexOf('#shlink:/')
      if (hashIndex !== -1) {
        uriToParse = shlinkURI.substring(hashIndex + 1)
      }

      // Validate shlink:/ prefix
      if (!uriToParse.startsWith('shlink:/')) {
        throw new SHLFormatError('Invalid SHLink URI: must start with "shlink:/"')
      }

      // Extract and decode the payload
      const payloadB64u = uriToParse.substring('shlink:/'.length)
      if (!payloadB64u) {
        throw new SHLFormatError('Invalid SHLink URI: missing payload')
      }

      // Decode base64url payload
      let payloadBytes: Uint8Array
      try {
        payloadBytes = base64url.decode(payloadB64u)
      } catch {
        throw new SHLFormatError('Invalid SHLink URI: payload is not valid base64url')
      }

      // Parse JSON payload
      const payloadJson = new TextDecoder().decode(payloadBytes)
      let payload: SHLinkPayloadV1
      try {
        payload = JSON.parse(payloadJson) as SHLinkPayloadV1
      } catch {
        throw new SHLFormatError('Invalid SHLink URI: payload is not valid JSON')
      }

      // Validate payload structure
      SHL.validatePayload(payload)

      // Extract base URL from the manifest URL
      const manifestURL = new URL(payload.url)
      // For SHL, the base URL is typically just the origin
      // e.g., https://shl.example.org/manifests/abc123/manifest.json -> https://shl.example.org
      const baseURL = manifestURL.origin

      // Create a reconstructed SHL object using the static factory method
      return SHL.fromPayload(payload, baseURL, manifestURL.pathname)
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLFormatError(`Failed to parse SHLink URI: ${errorMessage}`)
    }
  }

  /**
   * Fetch a manifest from the given URL.
   * Handles passcode challenges automatically if passcode is provided.
   */
  private async fetchManifest(params: {
    url: string
    recipient: string
    passcode?: string
    embeddedLengthMax?: number
  }): Promise<SHLManifestV1> {
    try {
      // Build manifest request per SHL spec
      const manifestRequest: SHLManifestRequestV1 = {
        recipient: params.recipient,
      }

      if (params.passcode) {
        manifestRequest.passcode = params.passcode
      }

      if (params.embeddedLengthMax !== undefined) {
        manifestRequest.embeddedLengthMax = params.embeddedLengthMax
      }

      // Make POST request to manifest URL per SHL spec
      const response = await this.fetchImpl(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(manifestRequest),
      })

      // Handle HTTP error responses
      if (!response.ok) {
        if (response.status === 401) {
          throw new SHLInvalidPasscodeError('Invalid or missing passcode')
        } else if (response.status === 404) {
          throw new SHLManifestNotFoundError('SHL manifest not found')
        } else if (response.status === 429) {
          throw new SHLManifestRateLimitError('Too many requests to SHL manifest')
        } else {
          throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
        }
      }

      // Parse manifest response
      let manifest: SHLManifestV1
      try {
        const manifestJson = await response.text()
        manifest = JSON.parse(manifestJson) as SHLManifestV1
      } catch {
        throw new SHLManifestError('Invalid manifest response: not valid JSON')
      }

      // Validate manifest structure
      this.validateManifest(manifest)

      return manifest
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to fetch SHL manifest: ${errorMessage}`)
    }
  }

  /**
   * Validates a SHL manifest structure
   */
  private validateManifest(manifest: unknown): asserts manifest is SHLManifestV1 {
    if (!manifest || typeof manifest !== 'object') {
      throw new SHLManifestError('Invalid manifest: must be an object')
    }

    const m = manifest as Record<string, unknown>

    if (!Array.isArray(m.files)) {
      throw new SHLManifestError('Invalid manifest: missing or invalid "files" array')
    }

    // Validate each file descriptor
    for (const [index, file] of m.files.entries()) {
      if (!file || typeof file !== 'object') {
        throw new SHLManifestError(`Invalid manifest: file[${index}] must be an object`)
      }

      const f = file as Record<string, unknown>

      if (!f.contentType || typeof f.contentType !== 'string') {
        throw new SHLManifestError(`Invalid manifest: file[${index}] missing "contentType"`)
      }

      // Validate content type
      const validContentTypes: SHLFileContentType[] = [
        'application/smart-health-card',
        'application/fhir+json',
      ]
      if (!validContentTypes.includes(f.contentType as SHLFileContentType)) {
        throw new SHLManifestError(`Invalid manifest: file[${index}] has unsupported content type`)
      }

      // Must have either embedded or location, but not both
      const hasEmbedded = typeof f.embedded === 'string'
      const hasLocation = typeof f.location === 'string'

      if (hasEmbedded && hasLocation) {
        throw new SHLManifestError(
          `Invalid manifest: file[${index}] cannot have both "embedded" and "location"`
        )
      }

      if (!hasEmbedded && !hasLocation) {
        throw new SHLManifestError(
          `Invalid manifest: file[${index}] must have either "embedded" or "location"`
        )
      }

      // Validate location URL if present
      if (hasLocation) {
        try {
          new URL(f.location as string)
        } catch {
          throw new SHLManifestError(
            `Invalid manifest: file[${index}] "location" is not a valid URL`
          )
        }
      }
    }
  }

  /**
   * Fetch and decrypt a file using the provided key.
   */
  private async fetchAndDecryptFile(params: {
    url: string
    key: string
  }): Promise<{ content: string; contentType: string }> {
    try {
      // Fetch the encrypted file
      const response = await this.fetchImpl(params.url, {
        method: 'GET',
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new SHLManifestNotFoundError('SHL file not found')
        } else if (response.status === 429) {
          throw new SHLManifestRateLimitError('Too many requests to SHL file')
        } else {
          throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
        }
      }

      // Get JWE content
      const jwe = await response.text()

      // Decrypt the file
      const decrypted = await decryptSHLFile({
        jwe,
        key: params.key,
      })

      return decrypted
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to fetch and decrypt SHL file: ${errorMessage}`)
    }
  }
}
