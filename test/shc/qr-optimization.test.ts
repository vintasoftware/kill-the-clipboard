// biome-ignore-all lint/suspicious/noExplicitAny: Tests intentionally exercise invalid branches
import type { Bundle, Immunization, Patient } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FHIRBundle,
  FHIRBundleProcessor,
  type SmartHealthCardConfigParams,
  SmartHealthCardIssuer,
  SmartHealthCardReader,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('QR Optimization Features', () => {
  let bundleProcessor: FHIRBundleProcessor
  let validBundle: FHIRBundle

  beforeEach(() => {
    bundleProcessor = new FHIRBundleProcessor()
    validBundle = createValidFHIRBundle()
  })

  describe('SMART Health Cards QR optimization requirements', () => {
    let optimizedBundle: FHIRBundle

    beforeEach(() => {
      const bundleWithAllElements: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: '123',
              meta: {
                versionId: '1',
                lastUpdated: '2023-01-01T00:00:00Z',
                security: [{ system: 'test', code: 'test' }],
              },
              text: { status: 'generated', div: '<div>Patient narrative</div>' },
              name: [{ text: 'Display Name', family: 'Doe', given: ['John'] }],
              identifier: [
                {
                  system: 'test',
                  value: '123',
                  type: {
                    coding: [{ system: 'test', code: 'test', display: 'Test Display' }],
                    text: 'Type Text',
                  },
                },
              ],
            },
          },
          {
            fullUrl: 'https://example.com/base/Immunization/456',
            resource: {
              resourceType: 'Immunization',
              id: '456',
              meta: { security: [{ system: 'test', code: 'secure' }] },
              status: 'completed',
              vaccineCode: {
                coding: [
                  {
                    system: 'http://hl7.org/fhir/sid/cvx',
                    code: '207',
                    display: 'COVID-19 vaccine',
                  },
                ],
                text: 'Vaccine Text',
              },
              patient: { reference: 'Patient/123' },
            },
          },
          {
            fullUrl: 'https://example.com/base/Condition/789',
            resource: {
              resourceType: 'Condition',
              id: '789',
              text: { status: 'generated', div: '<div>Condition narrative</div>' },
              subject: { reference: 'Patient/123' },
            },
          },
        ],
      }

      optimizedBundle = bundleProcessor.processForQR(bundleWithAllElements, {
        strictReferences: true,
      })
    })

    it('should remove Resource.id elements', () => {
      optimizedBundle.entry?.forEach(entry => {
        expect(entry.resource).not.toHaveProperty('id')
      })
    })

    it('should remove Resource.meta elements except meta.security', () => {
      optimizedBundle.entry?.forEach(entry => {
        const resource = entry.resource as { meta?: { security?: unknown[] } }
        if (resource.meta) {
          expect(Object.keys(resource.meta)).toEqual(['security'])
        }
      })
    })

    it('should remove DomainResource.text elements', () => {
      optimizedBundle.entry?.forEach(entry => {
        expect(entry.resource).not.toHaveProperty('text')
      })
    })

    it('should remove CodeableConcept.text elements', () => {
      const immunization = optimizedBundle.entry?.find(
        e => e.resource?.resourceType === 'Immunization'
      )?.resource as Immunization
      expect(immunization?.vaccineCode).not.toHaveProperty('text')

      const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
        ?.resource as Patient
      expect(patient?.identifier?.[0]?.type).not.toHaveProperty('text')
    })

    it('should remove Coding.display elements', () => {
      const immunization = optimizedBundle.entry?.find(
        e => e.resource?.resourceType === 'Immunization'
      )?.resource as Immunization
      immunization?.vaccineCode?.coding?.forEach(coding => {
        expect(coding).not.toHaveProperty('display')
      })

      const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
        ?.resource as Patient
      patient?.identifier?.[0]?.type?.coding?.forEach(coding => {
        expect(coding).not.toHaveProperty('display')
      })
    })

    it('should preserve display fields that are not within coding contexts', () => {
      const bundleWithDisplayFields: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: '123',
              generalPractitioner: [{ reference: 'Practitioner/456', display: 'Display Name' }],
            },
          },
          {
            fullUrl: 'https://example.com/base/Practitioner/456',
            resource: { resourceType: 'Practitioner', id: '456' },
          },
        ],
      }

      const optimized = bundleProcessor.processForQR(bundleWithDisplayFields, {
        strictReferences: true,
      })
      const patient = optimized.entry?.[0]?.resource as Patient
      expect(patient?.generalPractitioner?.[0]).toHaveProperty('display', 'Display Name')
    })

    it('should use short resource-scheme URIs for Bundle.entry.fullUrl', () => {
      optimizedBundle.entry?.forEach((entry, index) => {
        expect(entry.fullUrl).toBe(`resource:${index}`)
      })
    })

    it('should use short resource-scheme URIs for Reference.reference', () => {
      const immunization = optimizedBundle.entry?.find(
        e => e.resource?.resourceType === 'Immunization'
      )?.resource as Immunization
      expect(immunization?.patient?.reference).toBe('resource:0')
    })

    it('should throw exception for missing references in strict mode', () => {
      const bundleWithDisplayFields: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: '123',
              generalPractitioner: [{ reference: 'Practitioner/456' }],
            },
          },
        ],
      }

      expect(() =>
        bundleProcessor.processForQR(bundleWithDisplayFields, { strictReferences: true })
      ).toThrow('Reference "Practitioner/456" not found in bundle resources')
    })

    it('should not throw exception for missing references in non-strict mode', () => {
      const bundleWithDisplayFields: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: '123',
              generalPractitioner: [{ reference: 'Practitioner/456' }],
            },
          },
        ],
      }

      const optimized = bundleProcessor.processForQR(bundleWithDisplayFields, {
        strictReferences: false,
      })
      const patient = optimized.entry?.[0]?.resource as Patient
      expect(patient?.generalPractitioner?.[0]).toHaveProperty('reference', 'Practitioner/456')
    })

    it('should handle resources with null, undefined, and empty array values', () => {
      const bundleWithNullValues: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: '123',
              name: null as any,
              identifier: [] as any,
              telecom: undefined as any,
              birthDate: '1990-01-01',
            },
          },
        ],
      }

      const optimized = bundleProcessor.processForQR(bundleWithNullValues, {
        strictReferences: true,
      })
      const patient = optimized.entry?.[0]?.resource as Patient
      expect(patient).not.toHaveProperty('name')
      expect(patient).not.toHaveProperty('identifier')
      expect(patient).not.toHaveProperty('telecom')
      expect(patient.birthDate).toBe('1990-01-01')
      expect(patient).not.toHaveProperty('id')
    })

    it('should remove Resource.id from all resources', () => {
      const bundleWithIds: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.com/base/Patient/123',
            resource: {
              resourceType: 'Patient',
              id: 'patient-id-to-remove',
              name: [{ family: 'Test' }],
            },
          },
          {
            fullUrl: 'https://example.com/base/Observation/456',
            resource: {
              resourceType: 'Observation',
              id: 'observation-id-to-remove',
              status: 'final',
              code: { text: 'Test' },
            },
          },
        ],
      }

      const optimized = bundleProcessor.processForQR(bundleWithIds, { strictReferences: true })
      optimized.entry?.forEach(entry => {
        expect(entry.resource).not.toHaveProperty('id')
      })
    })
  })

  it('should remove id from Bundle root in QR optimization', () => {
    const bundleWithRootId: Bundle = {
      resourceType: 'Bundle',
      id: 'bundle-id-to-remove',
      type: 'collection',
      entry: [
        {
          fullUrl: 'https://example.com/base/Patient/123',
          resource: { resourceType: 'Patient', id: 'patient-id', name: [{ family: 'Doe' }] },
        },
      ],
    }

    const optimized = bundleProcessor.processForQR(bundleWithRootId, { strictReferences: true })
    expect(optimized).not.toHaveProperty('id')
    expect(optimized.entry).toBeDefined()
    expect(optimized.entry?.length).toBe(1)
  })

  it('should create SmartHealthCard with QR optimization enabled', async () => {
    const config: SmartHealthCardConfigParams = {
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
    }

    const issuer = new SmartHealthCardIssuer(config)
    const reader = new SmartHealthCardReader({
      publicKey: config.publicKey,
      enableQROptimization: config.enableQROptimization,
      strictReferences: config.strictReferences,
    })

    const healthCard = await issuer.issue(validBundle)
    const jws = healthCard.asJWS()
    expect(jws).toBeDefined()
    expect(typeof jws).toBe('string')

    const verifiedHealthCard = await reader.fromJWS(jws)
    expect(verifiedHealthCard).toBeDefined()
    const bundle = await verifiedHealthCard.asBundle()
    if (bundle.entry) {
      bundle.entry.forEach((entry, index) => {
        if (entry.fullUrl) {
          expect(entry.fullUrl).toBe(`resource:${index}`)
        }
      })
    }
  })

  it('should preserve bundle data integrity after optimization', async () => {
    const config = {
      issuer: 'https://example.com/issuer',
      privateKey: testPrivateKeyPKCS8,
      publicKey: testPublicKeySPKI,
      expirationTime: null,
      enableQROptimization: true,
      strictReferences: true,
    }

    const issuer = new SmartHealthCardIssuer(config)
    const reader = new SmartHealthCardReader({
      publicKey: config.publicKey,
      enableQROptimization: config.enableQROptimization,
      strictReferences: config.strictReferences,
    })

    const healthCard = await issuer.issue(validBundle)
    const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
    const optimizedBundle = await verifiedHealthCard.asBundle()

    expect(optimizedBundle.resourceType).toBe('Bundle')
    expect(optimizedBundle.type).toBe('collection')
    expect(optimizedBundle.entry).toHaveLength(validBundle.entry?.length || 0)

    if (optimizedBundle.entry && validBundle.entry) {
      for (let i = 0; i < optimizedBundle.entry.length; i++) {
        const optimizedResource = optimizedBundle.entry[i].resource
        const originalResource = validBundle.entry[i].resource
        if (optimizedResource && originalResource) {
          expect(optimizedResource.resourceType).toBe(originalResource.resourceType)
        }
      }
    }
  })
})
