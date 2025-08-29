// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to check validation errors
import type { Bundle } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FHIRBundle,
  FhirValidationError,
  type VerifiableCredential,
  type VerifiableCredentialParams,
  VerifiableCredentialProcessor,
} from '@/index'
import { createInvalidBundle, createValidFHIRBundle } from '../helpers'

describe('VerifiableCredentialProcessor', () => {
  let processor: VerifiableCredentialProcessor
  let validBundle: FHIRBundle

  beforeEach(() => {
    processor = new VerifiableCredentialProcessor()
    validBundle = createValidFHIRBundle()
  })

  describe('create()', () => {
    it('should create a valid W3C Verifiable Credential', () => {
      const vc = processor.create(validBundle)

      expect(vc).toBeDefined()
      expect(vc.vc).toBeDefined()
      expect(vc.vc.type).toBeDefined()
      expect(vc.vc.credentialSubject).toBeDefined()
    })

    it('should use default FHIR version 4.0.1', () => {
      const vc = processor.create(validBundle)
      expect(vc.vc.credentialSubject.fhirVersion).toBe('4.0.1')
    })

    it('should use custom FHIR version when provided', () => {
      const options: VerifiableCredentialParams = { fhirVersion: '4.3.0' }
      const vc = processor.create(validBundle, options)

      expect(vc.vc.credentialSubject.fhirVersion).toBe('4.3.0')
    })

    it('should include the provided FHIR Bundle', () => {
      const vc = processor.create(validBundle)
      expect(vc.vc.credentialSubject.fhirBundle).toEqual(validBundle)
    })

    it('should create correct type array', () => {
      const vc = processor.create(validBundle)
      const types = vc.vc.type

      expect(Array.isArray(types)).toBe(true)
      expect(types).toHaveLength(1)
      expect(types).toContain('https://smarthealth.cards#health-card')
    })

    it('should include additional types when provided', () => {
      const options: VerifiableCredentialParams = {
        includeAdditionalTypes: [
          'https://smarthealth.cards#covid19',
          'https://example.org/vaccination',
        ],
      }
      const vc = processor.create(validBundle, options)

      expect(vc.vc.type).toHaveLength(3)
      expect(vc.vc.type).toContain('https://smarthealth.cards#health-card')
      expect(vc.vc.type).toContain('https://smarthealth.cards#covid19')
      expect(vc.vc.type).toContain('https://example.org/vaccination')
    })

    it('should throw FhirValidationError for null bundle', () => {
      expect(() => processor.create(null as unknown as Bundle)).toThrow(FhirValidationError)
      expect(() => processor.create(null as unknown as Bundle)).toThrow(
        'Invalid FHIR Bundle provided'
      )
    })

    it('should throw FhirValidationError for invalid bundle', () => {
      const invalidBundle = createInvalidBundle()

      expect(() => processor.create(invalidBundle)).toThrow(FhirValidationError)
      expect(() => processor.create(invalidBundle)).toThrow('Invalid FHIR Bundle provided')
    })
  })

  describe('validate()', () => {
    let validVC: VerifiableCredential

    beforeEach(() => {
      validVC = processor.create(validBundle)
    })

    it('should validate a correct Verifiable Credential', () => {
      expect(processor.validate(validVC)).toBe(true)
    })

    it('should throw FhirValidationError for null VC', () => {
      expect(() => processor.validate(null as unknown as VerifiableCredential)).toThrow(
        FhirValidationError
      )
      expect(() => processor.validate(null as unknown as VerifiableCredential)).toThrow(
        'Invalid VC: missing vc property'
      )
    })

    it('should throw FhirValidationError for VC without vc property', () => {
      const invalidVC = {} as VerifiableCredential

      expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
      expect(() => processor.validate(invalidVC)).toThrow('Invalid VC: missing vc property')
    })

    describe('type validation', () => {
      it('should throw error for non-array type', () => {
        const invalidVC = { ...validVC }
        invalidVC.vc.type = 'not-an-array' as any

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow('VC type must be an array')
      })

      it('should throw error for type with less than 1 element', () => {
        const invalidVC = { ...validVC }
        invalidVC.vc.type = []

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC type must contain at least 1 element'
        )
      })

      it('should throw error for missing health-card type', () => {
        const invalidVC = { ...validVC }
        invalidVC.vc.type = ['SomeOtherType']

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC type must include https://smarthealth.cards#health-card'
        )
      })
    })

    describe('credentialSubject validation', () => {
      it('should throw error for missing credentialSubject', () => {
        const invalidVC = { ...validVC }
        delete (invalidVC.vc as Record<string, unknown>).credentialSubject

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow('VC credentialSubject is required')
      })

      it('should throw error for missing fhirVersion', () => {
        const invalidVC = { ...validVC }
        delete (invalidVC.vc.credentialSubject as Record<string, unknown>).fhirVersion

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC credentialSubject must include fhirVersion'
        )
      })

      it('should throw error for invalid fhirVersion format', () => {
        const invalidVC = { ...validVC }
        invalidVC.vc.credentialSubject.fhirVersion = 'invalid-version'

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC fhirVersion must be in semantic version format (e.g., 4.0.1)'
        )
      })

      it('should accept valid semantic versions', () => {
        const validVersions = ['4.0.1', '4.3.0', '5.0.0', '10.25.99']

        for (const version of validVersions) {
          const vc = { ...validVC }
          vc.vc.credentialSubject.fhirVersion = version
          expect(processor.validate(vc)).toBe(true)
        }
      })

      it('should throw error for missing fhirBundle', () => {
        const invalidVC = { ...validVC }
        delete (invalidVC.vc.credentialSubject as Record<string, unknown>).fhirBundle

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC credentialSubject must include fhirBundle'
        )
      })

      it('should throw error for invalid fhirBundle', () => {
        const invalidVC = { ...validVC }
        invalidVC.vc.credentialSubject.fhirBundle = {
          resourceType: 'Patient',
        } as any

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow(
          'VC fhirBundle must be a valid FHIR Bundle'
        )
      })
    })
  })
})
