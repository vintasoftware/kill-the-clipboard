// SmartHealthCardIssuer class

import { FHIRBundleProcessor } from './fhir/bundle-processor.js'
import { JWSProcessor } from './jws/jws-processor.js'
import { SmartHealthCard } from './shc.js'
import type {
  FHIRBundle,
  SmartHealthCardConfig,
  SmartHealthCardConfigParams,
  SmartHealthCardJWT,
  VerifiableCredentialParams,
} from './types.js'
import { VerifiableCredentialProcessor } from './vc.js'

/**
 * Issues new SMART Health Cards from FHIR Bundles.
 *
 * **Security Warning**: Issue/sign on a secure backend only; never expose the private key in browsers.
 *
 * @public
 * @group SHC
 * @category High-Level API
 */
export class SmartHealthCardIssuer {
  private config: SmartHealthCardConfig
  private bundleProcessor: FHIRBundleProcessor
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

    this.bundleProcessor = new FHIRBundleProcessor()
    this.vcProcessor = new VerifiableCredentialProcessor()
    this.jwsProcessor = new JWSProcessor()
  }

  /**
   * Issues a new SMART Health Card from a FHIR Bundle.
   *
   * @param fhirBundle - FHIR R4 Bundle containing medical data
   * @param config - Optional Verifiable Credential parameters. See {@link VerifiableCredentialParams}.
   * @returns Promise resolving to SmartHealthCard object
   * @throws {@link CredentialValidationError} When FHIR bundle is invalid
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
      ? this.bundleProcessor.processForQR(fhirBundle, {
          strictReferences: this.config.strictReferences,
        })
      : this.bundleProcessor.process(fhirBundle)
    this.bundleProcessor.validate(processedBundle)

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
