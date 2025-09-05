import { BundleValidationError, CredentialValidationError } from './errors.js'
import type { FHIRBundle, VerifiableCredential, VerifiableCredentialParams } from './types.js'

/**
 * Creates and validates Verifiable Credentials for SMART Health Cards.
 *
 * @public
 * @group SHC
 * @category Lower-Level API
 */
export class VerifiableCredentialProcessor {
  /**
   * Creates a Verifiable Credential from a FHIR Bundle.
   *
   * @param fhirBundle - FHIR Bundle to create credential from
   * @param config - Optional Verifiable Credential parameters. See {@link VerifiableCredentialParams}.
   * @returns Verifiable Credential structure
   * @throws {@link CredentialValidationError} When the input bundle is invalid
   */
  create(fhirBundle: FHIRBundle, config: VerifiableCredentialParams = {}): VerifiableCredential {
    if (!fhirBundle || fhirBundle.resourceType !== 'Bundle') {
      throw new CredentialValidationError('Invalid FHIR Bundle provided')
    }

    const fhirVersion = config.fhirVersion || '4.0.1'
    const type = this.createStandardTypes(config.includeAdditionalTypes)

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
   * @throws {@link CredentialValidationError} if validation fails
   */
  validate(vc: VerifiableCredential): boolean {
    try {
      if (!vc || !vc.vc) {
        throw new CredentialValidationError('Invalid VC: missing vc property')
      }

      this.validateTypes(vc.vc.type)
      this.validateCredentialSubject(vc.vc.credentialSubject)

      return true
    } catch (error) {
      if (error instanceof CredentialValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new CredentialValidationError(`VC validation failed: ${errorMessage}`)
    }
  }

  /** Creates the standard type array per SMART Health Cards specification */
  private createStandardTypes(additionalTypes?: string[]): string[] {
    const standardTypes = ['https://smarthealth.cards#health-card']

    if (additionalTypes && additionalTypes.length > 0) {
      return [...standardTypes, ...additionalTypes]
    }

    return standardTypes
  }

  /** Validates the type array */
  private validateTypes(types: string[]): void {
    if (!Array.isArray(types)) {
      throw new CredentialValidationError('VC type must be an array')
    }

    if (types.length < 1) {
      throw new CredentialValidationError('VC type must contain at least 1 element')
    }

    if (!types.includes('https://smarthealth.cards#health-card')) {
      throw new CredentialValidationError(
        'VC type must include https://smarthealth.cards#health-card'
      )
    }
  }

  /** Validates the credential subject */
  private validateCredentialSubject(credentialSubject: {
    fhirVersion: string
    fhirBundle: FHIRBundle
  }): void {
    if (!credentialSubject) {
      throw new CredentialValidationError('VC credentialSubject is required')
    }

    if (!credentialSubject.fhirVersion) {
      throw new CredentialValidationError('VC credentialSubject must include fhirVersion')
    }

    const fhirVersionRegex = /^\d+\.\d+\.\d+$/
    if (!fhirVersionRegex.test(credentialSubject.fhirVersion)) {
      throw new CredentialValidationError(
        'VC fhirVersion must be in semantic version format (e.g., 4.0.1)'
      )
    }

    if (!credentialSubject.fhirBundle) {
      throw new CredentialValidationError('VC credentialSubject must include fhirBundle')
    }

    if (credentialSubject.fhirBundle.resourceType !== 'Bundle') {
      throw new BundleValidationError('VC fhirBundle must be a valid FHIR Bundle')
    }
  }
}
