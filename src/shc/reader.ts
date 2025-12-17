// SHCReader class
import { importJWK } from 'jose'
import { Directory } from './directory.js'
import {
  FileFormatError,
  QRCodeError,
  SHCError,
  SHCReaderConfigError,
  SHCRevokedError,
  VerificationError,
} from './errors.js'
import { FHIRBundleProcessor } from './fhir/bundle-processor.js'
import { deriveKidFromPublicKey } from './jws/helpers.js'
import { JWSProcessor } from './jws/jws-processor.js'
import { QRCodeGenerator } from './qr/qr-code-generator.js'
import { SHC } from './shc.js'
import type { SHCReaderConfig, SHCReaderConfigParams, VerifiableCredential } from './types.js'
import { VerifiableCredentialProcessor } from './vc.js'

/**
 * Reads and verifies SMART Health Cards from various sources.
 *
 * @public
 * @group SHC
 * @category High-Level API
 */
export class SHCReader {
  private config: SHCReaderConfig
  private bundleProcessor: FHIRBundleProcessor
  private vcProcessor: VerifiableCredentialProcessor
  private jwsProcessor: JWSProcessor

  /**
   * Creates a new SHCReader instance.
   *
   * @param config - Configuration parameters for the reader
   *
   * @example
   * ```typescript
   * // Using PEM format keys
   * const reader = new SHCReader({
   *   publicKey: publicKeySPKIString, // ES256 public key in SPKI format
   * });
   *
   * // Using JsonWebKey format
   * const readerJWK = new SHCReader({
   *   publicKey: { kty: 'EC', crv: 'P-256', x: '...', y: '...' },
   * });
   *
   * // Using automatic key resolution from issuer JWKS
   * const readerAuto = new SHCReader({
   *   publicKey: null, // Will resolve from issuer's /.well-known/jwks.json
   * });
   * ```
   */
  constructor(config: SHCReaderConfigParams) {
    if (config.issuerDirectory && config.useVciDirectory) {
      throw new SHCReaderConfigError(
        'SHCReader configuration error: Cannot specify both issuerDirectory and useVciDirectory'
      )
    }

    this.config = {
      ...config,
      enableQROptimization: config.enableQROptimization ?? true,
      strictReferences: config.strictReferences ?? true,
      verifyExpiration: config.verifyExpiration ?? true,
      issuerDirectory: config.issuerDirectory ?? null,
      useVciDirectory: config.useVciDirectory ?? false,
    }

    this.bundleProcessor = new FHIRBundleProcessor()
    this.vcProcessor = new VerifiableCredentialProcessor()
    this.jwsProcessor = new JWSProcessor()
  }

  /**
   * Read and verify a SMART Health Card from file content.
   *
   * @param fileContent - File content as string or Blob from .smart-health-card files
   * @returns Promise resolving to verified SHC object
   * @throws {@link FileFormatError} If the file is not valid JSON or missing the `verifiableCredential` array
   * @throws {@link SignatureVerificationError} If JWS signature verification fails
   * @throws {@link ExpirationError} If the health card has expired
   * @throws {@link PayloadValidationError} If JWT payload validation fails
   * @throws {@link BundleValidationError} If FHIR Bundle validation fails
   * @throws {@link CredentialValidationError} If verifiable credential validation fails
   * @throws {@link JWSError} If JWS processing fails
   * @throws {@link VerificationError} For unexpected errors during verification or JWKS resolution (propagated from {@link fromJWS})
   */
  async fromFileContent(fileContent: string | Blob): Promise<SHC> {
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
      if (error instanceof SHCError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FileFormatError(
        `Invalid file format - expected JSON with verifiableCredential array: ${errorMessage}`
      )
    }

    // Verify and return SHC object
    return await this.fromJWS(jws)
  }

  /**
   * Read and verify a SMART Health Card JWS.
   *
   * @param jws - JWS string to verify
   * @returns Promise resolving to verified SHC object
   * @throws {@link SignatureVerificationError} If JWS signature verification fails
   * @throws {@link ExpirationError} If the health card has expired
   * @throws {@link PayloadValidationError} If JWT payload validation fails
   * @throws {@link BundleValidationError} If FHIR Bundle validation fails
   * @throws {@link CredentialValidationError} If verifiable credential validation fails
   * @throws {@link JWSError} If JWS processing fails
   * @throws {@link VerificationError} For unexpected errors during verification or JWKS resolution
   * @throws {@link SHCRevokedError} If the SMART Health Card has been revoked
   */
  async fromJWS(jws: string): Promise<SHC> {
    try {
      // Check if a directory was provided to the reader
      let directory: Directory | null = null
      if (this.config.issuerDirectory) {
        directory = this.config.issuerDirectory
      } else if (this.config.useVciDirectory) {
        directory = await Directory.fromVCI()
      }

      // First we try to get the public key from the config
      let publicKeyToUse = this.config.publicKey

      // If there's no public key in the config, resolve it from the directory
      if (!publicKeyToUse && directory) {
        try {
          publicKeyToUse = await this.resolvePublicKeyFromDirectory(jws, directory)
        } catch (error) {
          console.warn(
            `Failed to resolve public key from directory, will try to resolve from from issuer JWKS URL: ${error}`
          )
        }
      }

      // If all else fails, resolve public key via issuer JWKS URL, based on JWS header/payload
      if (!publicKeyToUse) {
        publicKeyToUse = await this.resolvePublicKeyFromJWKS(jws)
      }

      // Step 1: Verify JWS signature and extract payload (decompression handled automatically)
      const payload = await this.jwsProcessor.verify(jws, publicKeyToUse, {
        verifyExpiration: this.config.verifyExpiration,
      })

      // Step 2: Validate the FHIR Bundle
      const originalBundle = payload.vc.credentialSubject.fhirBundle
      this.bundleProcessor.validate(originalBundle)

      // Step 3: Validate the VC
      const vc: VerifiableCredential = { vc: payload.vc }
      this.vcProcessor.validate(vc)

      // Step 4: If there's a directory, we can check if the SHC
      // is revoked based on the issuer's CRLs.
      if (directory) {
        const issuer = directory.getIssuerByIss(payload.iss)
        const vcRid = payload.vc.rid
        if (issuer && vcRid) {
          const kid = await deriveKidFromPublicKey(publicKeyToUse)
          const crl = issuer.crls.get(kid)
          // If the CRL contains the rid, the SHC might
          // have been revoked
          if (crl && crl.rids.has(vcRid)) {
            const revocationTimestamp = crl.ridsTimestamps.get(vcRid)
            if (!revocationTimestamp) {
              // If the rid has no associated timestamp, it's revoked
              throw new SHCRevokedError('This SHC has been revoked')
            }
            // If the SHC was issued before the revocation timestamp, it's revoked
            const issuanceDateTimestamp = String(payload.nbf).split('.')[0]
            if (BigInt(issuanceDateTimestamp!) <= BigInt(revocationTimestamp)) {
              throw new SHCRevokedError('This SHC has been revoked')
            }
            // If it has been issued after the revocation timestamp,
            // it's valid and no further action is required
          }
        }
      }

      // Step 5: Return the original FHIR Bundle
      return new SHC(jws, originalBundle)
    } catch (error) {
      if (error instanceof SHCError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new VerificationError(`Failed to verify SMART Health Card: ${errorMessage}`)
    }
  }

  /**
   * Obtains the JWS header and payload without signature verification.
   * @throws {@link VerificationError} when the key cannot be resolved
   */
  private async parseUnverifiedJWS(jws: string) {
    // Decode without verification to obtain header.kid and payload.iss
    const { header, payload } = await this.jwsProcessor.parseUnverified(jws)

    if (!payload.iss || typeof payload.iss !== 'string') {
      throw new VerificationError("Cannot resolve JWK: missing 'iss' in payload")
    }
    if (!header.kid || typeof header.kid !== 'string') {
      throw new VerificationError("Cannot resolve JWK: missing 'kid' in JWS header")
    }

    return { header, payload }
  }

  /**
   * Resolves the public key for a JWS using the information contained on a directory instance.
   * @throws {@link VerificationError} when the key cannot be resolved
   */
  private async resolvePublicKeyFromDirectory(
    jws: string,
    directory: Directory
  ): Promise<CryptoKey | Uint8Array | string> {
    // Decode without verification to obtain header.kid and payload.iss
    const { header, payload } = await this.parseUnverifiedJWS(jws)
    const issuer = directory.getIssuerByIss(payload.iss)
    if (!issuer) {
      throw new VerificationError(`Issuer not found in directory for iss: ${payload.iss}`)
    }
    // From parseUnverifiedJWS we already ensured header.kid is present
    const matching = issuer.keys.get(header.kid!)
    if (!matching) {
      throw new VerificationError(`No matching key found in issuer for kid '${header.kid}'`)
    }
    return await importJWK(matching as JsonWebKey, 'ES256')
  }

  /**
   * Resolves the public key for a JWS using the issuer's well-known JWKS endpoint when no key is provided.
   * @throws {@link VerificationError} when the key cannot be resolved
   */
  private async resolvePublicKeyFromJWKS(jws: string): Promise<CryptoKey | Uint8Array | string> {
    try {
      // Decode without verification to obtain header.kid and payload.iss
      const { header, payload } = await this.parseUnverifiedJWS(jws)

      // Build JWKS URL from issuer origin
      const jwksUrl = `${payload.iss.replace(/\/$/, '')}/.well-known/jwks.json`

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
      if (error instanceof SHCError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new VerificationError(`Unable to resolve public key via JWKS endpoint: ${message}`)
    }
  }

  /**
   * Read and verify a SMART Health Card from QR numeric data.
   *
   * @param qrNumeric - Single QR code numeric string (format: `shc:/...`)
   * @returns Promise resolving to verified SHC object
   * @throws {@link QRCodeError} If the QR numeric string is malformed, contains out-of-range digit pairs, or decoding fails
   * @throws {@link SignatureVerificationError} If JWS signature verification fails
   * @throws {@link ExpirationError} If the health card has expired
   * @throws {@link PayloadValidationError} If JWT payload validation fails
   * @throws {@link BundleValidationError} If FHIR Bundle validation fails
   * @throws {@link CredentialValidationError} If verifiable credential validation fails
   * @throws {@link JWSError} If JWS processing fails
   * @throws {@link VerificationError} For unexpected errors during verification or JWKS resolution (propagated from {@link fromJWS})
   *
   * @example
   * ```typescript
   * // Single QR code
   * const qrNumeric = 'shc:/56762959532654603460292540772804336028...';
   * const healthCard = await reader.fromQRNumeric(qrNumeric);
   * ```
   */
  async fromQRNumeric(qrNumeric: string): Promise<SHC>

  /**
   * Read and verify a SMART Health Card from chunked QR numeric data.
   *
   * @param qrNumericChunks - Array of chunked QR code numeric strings (format: `shc:/index/total/...`)
   * @returns Promise resolving to verified SHC object
   * @throws {@link QRCodeError} If any chunk has invalid prefix, index/total, missing parts, out-of-range digit pairs, or decoding fails
   * @throws {@link SignatureVerificationError} If JWS signature verification fails
   * @throws {@link ExpirationError} If the health card has expired
   * @throws {@link PayloadValidationError} If JWT payload validation fails
   * @throws {@link BundleValidationError} If FHIR Bundle validation fails
   * @throws {@link CredentialValidationError} If verifiable credential validation fails
   * @throws {@link JWSError} If JWS processing fails
   * @throws {@link VerificationError} For unexpected errors during verification or JWKS resolution (propagated from {@link fromJWS})
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
  async fromQRNumeric(qrNumericChunks: string[]): Promise<SHC>

  /** @internal */
  async fromQRNumeric(qrData: string | string[]): Promise<SHC> {
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
      if (error instanceof SHCError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new QRCodeError(
        `Failed to read SMART Health Card from QR numeric data: ${errorMessage}`
      )
    }
  }
}
