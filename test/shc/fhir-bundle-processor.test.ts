// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to check validation errors
import type { Bundle } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it } from 'vitest'
import { FHIRBundleProcessor, FhirValidationError } from '@/index'
import { createInvalidBundle, createValidFHIRBundle } from '../helpers'

describe('FHIRBundleProcessor', () => {
  let processor: FHIRBundleProcessor

  beforeEach(() => {
    processor = new FHIRBundleProcessor()
  })

  describe('process()', () => {
    it('should process a valid FHIR Bundle', () => {
      const bundle = createValidFHIRBundle()
      const result = processor.process(bundle)

      expect(result).toBeDefined()
      expect(result.resourceType).toBe('Bundle')
      expect(result.type).toBe('collection')
    })

    it('should set default Bundle.type to "collection"', () => {
      const bundle = createValidFHIRBundle()
      delete (bundle as unknown as Record<string, unknown>).type

      const result = processor.process(bundle)
      expect(result.type).toBe('collection')
    })

    it('should preserve existing Bundle.type if specified', () => {
      const bundle = createValidFHIRBundle()
      bundle.type = 'batch'

      const result = processor.process(bundle)
      expect(result.type).toBe('batch')
    })

    it('should not modify the original bundle', () => {
      const bundle = createValidFHIRBundle()
      const originalType = bundle.type

      processor.process(bundle)
      expect(bundle.type).toBe(originalType)
    })

    it('should throw FhirValidationError for null bundle', () => {
      expect(() => processor.process(null as unknown as Bundle)).toThrow(FhirValidationError)
      expect(() => processor.process(null as unknown as Bundle)).toThrow(
        'Invalid bundle: must be a FHIR Bundle resource'
      )
    })

    it('should throw FhirValidationError for invalid bundle', () => {
      const invalidBundle = createInvalidBundle()

      expect(() => processor.process(invalidBundle)).toThrow(FhirValidationError)
      expect(() => processor.process(invalidBundle)).toThrow(
        'Invalid bundle: must be a FHIR Bundle resource'
      )
    })
  })

  describe('validate()', () => {
    it('should validate a correct FHIR Bundle', () => {
      const bundle = createValidFHIRBundle()
      expect(processor.validate(bundle)).toBe(true)
    })

    it('should throw FhirValidationError for null bundle', () => {
      expect(() => processor.validate(null as unknown as Bundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(null as unknown as Bundle)).toThrow(
        'Bundle cannot be null or undefined'
      )
    })

    it('should throw FhirValidationError for wrong resource type', () => {
      const invalidBundle = createInvalidBundle()

      expect(() => processor.validate(invalidBundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(invalidBundle)).toThrow('Resource must be of type Bundle')
    })

    it('should throw FhirValidationError for invalid Bundle.type', () => {
      const bundle = createValidFHIRBundle()
      ;(bundle as any).type = 'invalid-type'
      expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(bundle)).toThrow('Invalid bundle.type: invalid-type')
    })

    it('should accept common FHIR Bundle.type values', () => {
      const acceptedTypes = [
        'collection',
        'batch',
        'history',
        'searchset',
        'transaction',
        'transaction-response',
      ]
      for (const t of acceptedTypes) {
        const b = createValidFHIRBundle()
        ;(b as any).type = t
        expect(processor.validate(b)).toBe(true)
      }
    })

    it('should throw FhirValidationError for non-array entry', () => {
      const bundle = createValidFHIRBundle()
      bundle.entry = 'not-an-array' as any

      expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(bundle)).toThrow('Bundle.entry must be an array')
    })

    it('should throw FhirValidationError for entry without resource', () => {
      const bundle = createValidFHIRBundle()
      bundle.entry = [{ fullUrl: 'test' }] as any

      expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(bundle)).toThrow('Bundle.entry[0] must contain a resource')
    })

    it('should throw FhirValidationError for resource without resourceType', () => {
      const bundle = createValidFHIRBundle()
      bundle.entry = [{ resource: { id: '123' } }] as any

      expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
      expect(() => processor.validate(bundle)).toThrow(
        'Bundle.entry[0].resource must have a resourceType'
      )
    })
  })
})
