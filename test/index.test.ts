// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to check validation errors

import type { Bundle, Immunization, Patient } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FHIRBundle,
  FHIRBundleProcessor,
  FhirValidationError,
  FileFormatError,
  InvalidBundleReferenceError,
  JWSError,
  JWSProcessor,
  QRCodeError,
  QRCodeGenerator,
  type SmartHealthCardConfig,
  type SmartHealthCardConfigParams,
  SmartHealthCardError,
  SmartHealthCardIssuer,
  type SmartHealthCardJWT,
  SmartHealthCardReader,
  type SmartHealthCardReaderConfigParams,
  type VerifiableCredential,
  type VerifiableCredentialParams,
  VerifiableCredentialProcessor,
  VerificationError,
} from '../src/index'

// Test data fixtures
const createValidFHIRBundle = (): FHIRBundle => ({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'https://example.com/base/Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123',
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
    {
      fullUrl: 'https://example.com/base/Immunization/456',
      resource: {
        resourceType: 'Immunization',
        id: '456',
        status: 'completed',
        vaccineCode: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/cvx',
              code: '207',
              display: 'COVID-19 vaccine',
            },
          ],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
})

const createInvalidBundle = (): Bundle => ({
  resourceType: 'Patient' as any, // Wrong resource type
  id: '123',
  type: 'collection',
})

describe('SMART Health Cards Library', () => {
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
        bundle.entry = 'not-an-array' as any // @ts-ignore

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry must be an array')
      })

      it('should throw FhirValidationError for entry without resource', () => {
        const bundle = createValidFHIRBundle()
        bundle.entry = [{ fullUrl: 'test' }] as any // @ts-ignore

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry[0] must contain a resource')
      })

      it('should throw FhirValidationError for resource without resourceType', () => {
        const bundle = createValidFHIRBundle()
        bundle.entry = [{ resource: { id: '123' } }] as any // @ts-ignore

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow(
          'Bundle.entry[0].resource must have a resourceType'
        )
      })
    })
  })

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
          invalidVC.vc.type = 'not-an-array' as any // @ts-ignore

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
          } as any // @ts-ignore

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC fhirBundle must be a valid FHIR Bundle'
          )
        })
      })
    })
  })

  describe('JWSProcessor', () => {
    let processor: JWSProcessor
    let validBundle: FHIRBundle
    let vcProcessor: VerifiableCredentialProcessor
    let validVC: VerifiableCredential
    let validJWTPayload: SmartHealthCardJWT

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(async () => {
      processor = new JWSProcessor()
      validBundle = createValidFHIRBundle()
      vcProcessor = new VerifiableCredentialProcessor()
      validVC = vcProcessor.create(validBundle)

      // Create a valid JWT payload
      const now = Math.floor(Date.now() / 1000)
      validJWTPayload = {
        iss: 'https://example.com/issuer',
        nbf: now,
        exp: now + 3600, // 1 hour from now
        vc: validVC.vc,
      }
    })

    describe('sign()', () => {
      it('should sign a valid JWT payload', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)

        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // JWS should have 3 parts separated by dots
        const parts = jws.split('.')
        expect(parts).toHaveLength(3)

        // Inspect header and payload via verify/decoder
        const { decodeProtectedHeader, importSPKI, exportJWK, calculateJwkThumbprint } =
          await import('jose')
        const header = decodeProtectedHeader(jws)
        expect(header.alg).toBe('ES256')

        // Verify kid is derived from the provided public key (JWK thumbprint per SMART Health Cards spec)
        const keyObj = await importSPKI(testPublicKeySPKI, 'ES256')
        const jwk = await exportJWK(keyObj)
        const expectedKid = await calculateJwkThumbprint(jwk)
        expect(header.kid).toBe(expectedKid)
        const verified = await processor.verify(jws, testPublicKeySPKI)
        expect(verified.iss).toBe(validJWTPayload.iss)
        expect(verified.nbf).toBe(validJWTPayload.nbf)
      })

      it('should sign with CryptoKey objects', async () => {
        const { importPKCS8, importSPKI } = await import('jose')

        const privateKeyCrypto = await importPKCS8(testPrivateKeyPKCS8, 'ES256')
        const publicKeyCrypto = await importSPKI(testPublicKeySPKI, 'ES256')

        const jws = await processor.sign(validJWTPayload, privateKeyCrypto, publicKeyCrypto)

        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // JWS should have 3 parts separated by dots
        const parts = jws.split('.')
        expect(parts).toHaveLength(3)

        // Should be verifiable
        const verified = await processor.verify(jws, publicKeyCrypto)
        expect(verified.iss).toBe(validJWTPayload.iss)
        expect(verified.nbf).toBe(validJWTPayload.nbf)
      })

      it('should throw JWSError for invalid payload', async () => {
        const invalidPayload = {
          // Missing required 'iss' field
          nbf: Math.floor(Date.now() / 1000),
          vc: validVC.vc,
        } as any // @ts-ignore

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
      })

      it('should throw JWSError for null payload', async () => {
        await expect(
          processor.sign(
            null as unknown as SmartHealthCardJWT,
            testPrivateKeyPKCS8,
            testPublicKeySPKI
          )
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(
            null as unknown as SmartHealthCardJWT,
            testPrivateKeyPKCS8,
            testPublicKeySPKI
          )
        ).rejects.toThrow('Invalid JWT payload: must be an object')
      })

      it('should throw JWSError for missing issuer', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as Record<string, unknown>).iss

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow("'iss' (issuer) is required")
      })

      it('should throw JWSError for missing nbf', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as Record<string, unknown>).nbf

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow("'nbf' (not before) is required")
      })

      it('should throw JWSError for invalid exp vs nbf', async () => {
        const invalidPayload = { ...validJWTPayload }
        invalidPayload.exp = invalidPayload.nbf - 1000 // exp before nbf

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow("'exp' must be greater than 'nbf'")
      })

      it('should work without exp field', async () => {
        const payloadWithoutExp = { ...validJWTPayload }
        delete payloadWithoutExp.exp

        const jws = await processor.sign(payloadWithoutExp, testPrivateKeyPKCS8, testPublicKeySPKI)
        expect(jws).toBeDefined()
        const verified = await processor.verify(jws, testPublicKeySPKI)
        expect(verified.exp).toBeUndefined()
      })
    })

    describe('verify()', () => {
      it('should verify a valid JWS', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        const verifiedPayload = await processor.verify(jws, testPublicKeySPKI)

        expect(verifiedPayload).toBeDefined()
        expect(verifiedPayload.iss).toBe(validJWTPayload.iss)
        expect(verifiedPayload.nbf).toBe(validJWTPayload.nbf)
        expect(verifiedPayload.exp).toBe(validJWTPayload.exp)
        expect(verifiedPayload.vc).toEqual(validJWTPayload.vc)
      })

      it('should verify JWS with CryptoKey public key', async () => {
        const { importSPKI } = await import('jose')

        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        const publicKeyCrypto = await importSPKI(testPublicKeySPKI, 'ES256')
        const verifiedPayload = await processor.verify(jws, publicKeyCrypto)

        expect(verifiedPayload).toBeDefined()
        expect(verifiedPayload.iss).toBe(validJWTPayload.iss)
        expect(verifiedPayload.nbf).toBe(validJWTPayload.nbf)
        expect(verifiedPayload.exp).toBe(validJWTPayload.exp)
        expect(verifiedPayload.vc).toEqual(validJWTPayload.vc)
      })

      it('should throw JWSError for invalid JWS format', async () => {
        await expect(processor.verify('invalid.jws', testPublicKeySPKI)).rejects.toThrow(JWSError)
        await expect(processor.verify('invalid.jws', testPublicKeySPKI)).rejects.toThrow(
          'JWS verification failed: Invalid Compact JWS'
        )
      })

      it('should throw JWSError for empty JWS', async () => {
        await expect(processor.verify('', testPublicKeySPKI)).rejects.toThrow(JWSError)
        await expect(processor.verify('', testPublicKeySPKI)).rejects.toThrow(
          'Invalid JWS: must be a non-empty string'
        )
      })

      it('should throw JWSError for non-string JWS', async () => {
        await expect(
          processor.verify(null as unknown as string, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(processor.verify(123 as unknown as string, testPublicKeySPKI)).rejects.toThrow(
          JWSError
        )
      })

      it('should throw JWSError for wrong public key', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
        // Try to verify with wrong public key (using the private key string, which will fail)
        await expect(processor.verify(jws, 'wrong-public-key')).rejects.toThrow(JWSError)
      })

      it('should verify an uncompressed JWS (no zip header)', async () => {
        const jws = await processor.sign(
          { ...validJWTPayload },
          testPrivateKeyPKCS8,
          testPublicKeySPKI,
          false
        )
        const verifiedPayload = await processor.verify(jws, testPublicKeySPKI)
        expect(verifiedPayload.iss).toBe(validJWTPayload.iss)
        expect(verifiedPayload.vc).toEqual(validJWTPayload.vc)
      })
    })

    describe('validateJWTPayload() private method validation', () => {
      it('should validate payload structure through sign method', async () => {
        // Test various invalid payloads
        const testCases = [
          {
            payload: { iss: 123, nbf: Date.now(), vc: validVC.vc }, // invalid iss type
            error: "'iss' (issuer) is required and must be a string",
          },
          {
            payload: { iss: 'test', nbf: 'invalid', vc: validVC.vc }, // invalid nbf type
            error: "'nbf' (not before) is required and must be a number",
          },
          {
            payload: {
              iss: 'test',
              nbf: Date.now(),
              exp: 'invalid',
              vc: validVC.vc,
            }, // invalid exp type
            error: "'exp' (expiration) must be a number if provided",
          },
          {
            payload: { iss: 'test', nbf: Date.now() }, // missing vc
            error: "'vc' (verifiable credential) is required and must be an object",
          },
        ]

        for (const testCase of testCases) {
          await expect(
            processor.sign(
              testCase.payload as any, // @ts-ignore
              testPrivateKeyPKCS8,
              testPublicKeySPKI
            )
          ).rejects.toThrow(JWSError)
          await expect(
            processor.sign(
              testCase.payload as any, // @ts-ignore
              testPrivateKeyPKCS8,
              testPublicKeySPKI
            )
          ).rejects.toThrow(testCase.error)
        }
      })
    })
  })

  describe('SmartHealthCard', () => {
    let issuer: SmartHealthCardIssuer
    let reader: SmartHealthCardReader
    let validBundle: FHIRBundle
    let issuerConfig: SmartHealthCardConfig
    let readerConfig: SmartHealthCardReaderConfigParams

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(() => {
      validBundle = createValidFHIRBundle()
      issuerConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        expirationTime: null,
        enableQROptimization: false,
        strictReferences: true,
      }
      readerConfig = {
        publicKey: testPublicKeySPKI,
        enableQROptimization: false,
        strictReferences: true,
      }
      issuer = new SmartHealthCardIssuer(issuerConfig)
      reader = new SmartHealthCardReader(readerConfig)
    })

    describe('issue()', () => {
      it('should issue a complete SMART Health Card from FHIR Bundle', async () => {
        const healthCard = await issuer.issue(validBundle)
        const jws = healthCard.asJWS()

        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // Should be a valid JWS format (3 parts separated by dots)
        const parts = jws.split('.')
        expect(parts).toHaveLength(3)
      })

      it('should issue SMART Health Card with CryptoKey objects', async () => {
        const { importPKCS8, importSPKI } = await import('jose')

        const privateKeyCrypto = await importPKCS8(testPrivateKeyPKCS8, 'ES256')
        const publicKeyCrypto = await importSPKI(testPublicKeySPKI, 'ES256')

        const configWithCryptoKeys: SmartHealthCardConfig = {
          issuer: 'https://example.com/issuer',
          privateKey: privateKeyCrypto,
          publicKey: publicKeyCrypto,
          expirationTime: null,
          enableQROptimization: false,
          strictReferences: true,
        }
        const issuerWithCryptoKeys = new SmartHealthCardIssuer(configWithCryptoKeys)
        const readerWithCryptoKeys = new SmartHealthCardReader({
          publicKey: publicKeyCrypto,
          enableQROptimization: false,
          strictReferences: true,
        })

        const healthCard = await issuerWithCryptoKeys.issue(validBundle)
        const jws = healthCard.asJWS()

        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // Should be a valid JWS format (3 parts separated by dots)
        const parts = jws.split('.')
        expect(parts).toHaveLength(3)

        // Should be verifiable
        const verifiedHealthCard = await readerWithCryptoKeys.fromJWS(jws)
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toBeDefined()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should issue health card with expiration when configured', async () => {
        const configWithExpiration: SmartHealthCardConfig = {
          ...issuerConfig,
          expirationTime: 3600, // 1 hour
        }
        const issuerWithExpiration = new SmartHealthCardIssuer(configWithExpiration)

        const healthCard = await issuerWithExpiration.issue(validBundle)
        const jws = healthCard.asJWS()
        expect(jws).toBeDefined()

        // Check header and payload
        const jwsProcessor = new JWSProcessor()
        const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
        expect(verified.exp).toBeDefined()
        expect((verified.exp as number) > verified.nbf).toBe(true)
      })

      it('should throw error for invalid FHIR Bundle', async () => {
        const invalidBundle = createInvalidBundle()

        await expect(issuer.issue(invalidBundle)).rejects.toThrow(FhirValidationError)
        await expect(issuer.issue(invalidBundle)).rejects.toThrow(
          'Invalid bundle: must be a FHIR Bundle resource'
        )
      })

      it('should throw error for null bundle', async () => {
        await expect(issuer.issue(null as unknown as Bundle)).rejects.toThrow(FhirValidationError)
      })

      it('should include correct issuer in JWT payload', async () => {
        const healthCard = await issuer.issue(validBundle)
        const jws = healthCard.asJWS()

        const jwsProcessor = new JWSProcessor()
        const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
        expect(verified.iss).toBe(issuerConfig.issuer)
        expect(verified.nbf).toBeDefined()
        expect(verified.vc).toBeDefined()
      })

      it('should create verifiable credential with correct structure', async () => {
        const healthCard = await issuer.issue(validBundle)
        const jws = healthCard.asJWS()

        const jwsProcessor = new JWSProcessor()
        const verified = await jwsProcessor.verify(jws, testPublicKeySPKI)
        // Check VC structure
        expect(verified.vc.type).toContain('https://smarthealth.cards#health-card')
        expect(verified.vc.credentialSubject).toBeDefined()
        expect(verified.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })
    })

    describe('verification with SmartHealthCardReader', () => {
      it('should verify a valid SMART Health Card', async () => {
        const healthCard = await issuer.issue(validBundle)
        const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
        const verifiedBundle = await verifiedHealthCard.asBundle()

        expect(verifiedBundle).toBeDefined()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should throw error for invalid JWS', async () => {
        await expect(reader.fromJWS('invalid.jws.signature')).rejects.toThrow(JWSError)
      })

      it('should throw error for tampered health card', async () => {
        const healthCard = await issuer.issue(validBundle)
        const jws = healthCard.asJWS()

        // Tamper with the health card by changing a character
        const tamperedCard = `${jws.slice(0, -5)}XXXXX`

        await expect(reader.fromJWS(tamperedCard)).rejects.toThrow(JWSError)
      })

      it('should validate round-trip: issue then verify', async () => {
        const healthCard = await issuer.issue(validBundle)
        const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
        const verifiedBundle = await verifiedHealthCard.asBundle()

        // The verified bundle should match the original
        expect(verifiedBundle).toEqual(validBundle)
        expect(verifiedBundle.resourceType).toBe('Bundle')
      })
    })

    describe('SmartHealthCard object methods', () => {
      it('should return the original bundle with asBundle()', async () => {
        const healthCard = await issuer.issue(validBundle)
        const bundleFromCard = await healthCard.asBundle()

        expect(bundleFromCard).toEqual(validBundle)
      })

      it('should return the original bundle with getOriginalBundle()', async () => {
        const healthCard = await issuer.issue(validBundle)
        const originalBundle = healthCard.getOriginalBundle()

        expect(originalBundle).toEqual(validBundle)
      })

      it('should return JWS string with asJWS()', async () => {
        const healthCard = await issuer.issue(validBundle)
        const jws = healthCard.asJWS()

        expect(typeof jws).toBe('string')
        expect(jws.split('.')).toHaveLength(3)
      })

      it('should return optimized bundle when asBundle() is called with optimizeForQR=true', async () => {
        const healthCard = await issuer.issue(validBundle)
        const optimizedBundle = await healthCard.asBundle(true, true)

        expect(optimizedBundle).toBeDefined()
        expect(optimizedBundle.resourceType).toBe('Bundle')

        // Check that QR optimization was applied - fullUrls should use resource scheme
        if (optimizedBundle.entry) {
          optimizedBundle.entry.forEach((entry, index) => {
            expect(entry.fullUrl).toBe(`resource:${index}`)
          })
        }

        // Resources should not have id fields (removed in QR optimization)
        optimizedBundle.entry?.forEach(entry => {
          expect(entry.resource).not.toHaveProperty('id')
        })
      })

      it('should return original bundle when asBundle() is called with optimizeForQR=false', async () => {
        const healthCard = await issuer.issue(validBundle)
        const originalBundle = await healthCard.asBundle(false)

        expect(originalBundle).toBeDefined()
        expect(originalBundle).toEqual(validBundle)
      })
    })

    describe('file operations with new API', () => {
      it('should create file content and read back correctly', async () => {
        const healthCard = await issuer.issue(validBundle)
        const fileContent = await healthCard.asFileContent()

        const verifiedHealthCard = await reader.fromFileContent(fileContent)
        const verifiedBundle = await verifiedHealthCard.asBundle()

        expect(verifiedBundle).toEqual(validBundle)
        expect(verifiedBundle.resourceType).toBe('Bundle')
        expect(verifiedBundle.entry).toHaveLength(2)
      })

      it('should create file blob and read back correctly', async () => {
        const healthCard = await issuer.issue(validBundle)
        const fileBlob = await healthCard.asFileBlob()

        expect(fileBlob).toBeInstanceOf(Blob)
        expect(fileBlob.type).toBe('application/smart-health-card')

        const verifiedHealthCard = await reader.fromFileContent(fileBlob)
        const verifiedBundle = await verifiedHealthCard.asBundle()

        expect(verifiedBundle).toEqual(validBundle)
        expect(verifiedBundle.resourceType).toBe('Bundle')
        expect(verifiedBundle.entry).toHaveLength(2)
      })

      it('should handle round-trip file operations', async () => {
        // Create health card and file
        const healthCard = await issuer.issue(validBundle)
        const fileBlob = await healthCard.asFileBlob()

        // Read back from file
        const verifiedHealthCard = await reader.fromFileContent(fileBlob)
        const extractedBundle = await verifiedHealthCard.asBundle()

        // Data should match original
        expect(extractedBundle).toEqual(validBundle)
      })
    })

    describe('SmartHealthCard output formats', () => {
      it('should create file content in correct format', async () => {
        const healthCard = await issuer.issue(validBundle)
        const fileContent = await healthCard.asFileContent()

        expect(fileContent).toBeDefined()
        expect(typeof fileContent).toBe('string')

        // Should be valid JSON with verifiableCredential array
        const parsed = JSON.parse(fileContent)
        expect(parsed).toHaveProperty('verifiableCredential')
        expect(Array.isArray(parsed.verifiableCredential)).toBe(true)
        expect(parsed.verifiableCredential).toHaveLength(1)

        // The JWS should be valid
        const jws = parsed.verifiableCredential[0]
        expect(typeof jws).toBe('string')
        expect(jws.split('.')).toHaveLength(3)
      })

      it('should create downloadable file blob', async () => {
        const healthCard = await issuer.issue(validBundle)
        const blob = await healthCard.asFileBlob()

        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('application/smart-health-card')
        expect(blob.size).toBeGreaterThan(0)
      })

      it('should generate QR codes', async () => {
        const healthCard = await issuer.issue(validBundle)
        const qrCodes = await healthCard.asQR()

        expect(Array.isArray(qrCodes)).toBe(true)
        expect(qrCodes.length).toBeGreaterThan(0)

        // Each QR code should be a data URL
        qrCodes.forEach(qr => {
          expect(typeof qr).toBe('string')
          expect(qr).toMatch(/^data:image\/png;base64,/)
        })
      })

      it('should generate QR numeric strings', async () => {
        const healthCard = await issuer.issue(validBundle)
        const qrNumericStrings = healthCard.asQRNumeric()

        expect(Array.isArray(qrNumericStrings)).toBe(true)
        expect(qrNumericStrings.length).toBeGreaterThan(0)

        // Each string should be in SMART Health Cards format
        qrNumericStrings.forEach(qrString => {
          expect(typeof qrString).toBe('string')
          expect(qrString).toMatch(/^shc:\//)
        })

        // Should be single QR code for normal sized data
        expect(qrNumericStrings).toHaveLength(1)
      })

      it('should generate chunked QR numeric strings when configured', async () => {
        const healthCard = await issuer.issue(validBundle)
        const chunkedQRStrings = healthCard.asQRNumeric({
          enableChunking: true,
          maxSingleQRSize: 100, // Force chunking
        })

        expect(Array.isArray(chunkedQRStrings)).toBe(true)
        expect(chunkedQRStrings.length).toBeGreaterThan(1) // Should be chunked

        // Each chunk should have the proper format
        chunkedQRStrings.forEach((qrString, index) => {
          expect(typeof qrString).toBe('string')
          expect(qrString).toMatch(/^shc:\/\d+\/\d+\//)

          // Verify chunk index and total
          const parts = qrString.split('/')
          expect(parts).toHaveLength(4) // shc:, chunkIndex, total, data
          expect(parseInt(parts[1])).toBe(index + 1) // 1-based indexing
          expect(parseInt(parts[2])).toBe(chunkedQRStrings.length) // Total chunks
        })
      })
    })

    describe('fromQRNumeric() method', () => {
      it('should read and verify a SMART Health Card from single QR numeric data', async () => {
        // Step 1: Issue health card and generate QR numeric strings
        const healthCard = await issuer.issue(validBundle)
        const qrNumericStrings = healthCard.asQRNumeric()
        expect(qrNumericStrings).toHaveLength(1) // Should be a single QR code

        // Step 2: Read from QR numeric data
        const verifiedHealthCard = await reader.fromQRNumeric(qrNumericStrings[0])
        expect(verifiedHealthCard).toBeDefined()

        // Step 3: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should read and verify a SMART Health Card from chunked QR numeric data', async () => {
        // Step 1: Issue health card with chunking enabled
        const healthCard = await issuer.issue(validBundle)
        const qrChunks = healthCard.asQRNumeric({
          enableChunking: true,
          maxSingleQRSize: 100, // Small size to force chunking
        })
        expect(qrChunks.length).toBeGreaterThan(1) // Ensure it's chunked

        // Step 2: Read from chunked QR numeric data
        const verifiedHealthCard = await reader.fromQRNumeric(qrChunks)
        expect(verifiedHealthCard).toBeDefined()

        // Step 3: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should surface QRCodeError from QR decoding', async () => {
        // Invalid format (missing shc:/ prefix) triggers QRCodeError inside scanner
        await expect(reader.fromQRNumeric('invalid-qr-data')).rejects.toThrow(QRCodeError)
        await expect(reader.fromQRNumeric('invalid-qr-data')).rejects.toThrow(
          "Invalid QR code format. Expected 'shc:/' prefix."
        )
      })
    })

    describe('end-to-end workflow', () => {
      it('should handle complete SMART Health Card workflow', async () => {
        // Step 1: Issue health card from FHIR bundle
        const healthCard = await issuer.issue(validBundle)
        expect(healthCard).toBeDefined()

        // Step 2: Get JWS representation
        const jws = healthCard.asJWS()
        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // Step 3: Verify the health card using reader
        const verifiedHealthCard = await reader.fromJWS(jws)
        expect(verifiedHealthCard).toBeDefined()

        // Step 4: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should handle complete file-based workflow', async () => {
        // Step 1: Issue health card and create file
        const healthCard = await issuer.issue(validBundle)
        const blob = await healthCard.asFileBlob()
        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('application/smart-health-card')

        // Step 2: Read and verify the file
        const verifiedHealthCard = await reader.fromFileContent(blob)
        expect(verifiedHealthCard).toBeDefined()

        // Step 3: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should handle complete QR numeric workflow', async () => {
        // Step 1: Issue health card
        const healthCard = await issuer.issue(validBundle)

        // Step 2: Generate QR numeric data
        const qrNumericChunks = healthCard.asQRNumeric()
        expect(qrNumericChunks).toHaveLength(1) // Should be single QR code

        // Step 3: Read and verify from QR numeric data
        const verifiedHealthCard = await reader.fromQRNumeric(qrNumericChunks[0])
        expect(verifiedHealthCard).toBeDefined()

        // Step 4: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })

      it('should handle complete chunked QR numeric workflow', async () => {
        // Step 1: Issue health card
        const healthCard = await issuer.issue(validBundle)

        // Step 2: Create chunks (simulate what would be in QR codes)
        const qrNumericChunks = healthCard.asQRNumeric({
          enableChunking: true,
          maxSingleQRSize: 150,
        })
        expect(qrNumericChunks.length).toBeGreaterThan(1) // Should be chunked

        // Step 3: Read and verify from QR numeric data
        const verifiedHealthCard = await reader.fromQRNumeric(qrNumericChunks)

        // Step 4: Verify data integrity
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(validBundle)
      })
    })
  })

  describe('QRCodeGenerator', () => {
    let qrGenerator: QRCodeGenerator
    let validJWS: string

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(async () => {
      qrGenerator = new QRCodeGenerator()

      // Create a valid JWS for testing
      const issuer = new SmartHealthCardIssuer({
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        expirationTime: null,
        enableQROptimization: false,
        strictReferences: true,
      })

      const validBundle = createValidFHIRBundle()
      const healthCard = await issuer.issue(validBundle)
      validJWS = healthCard.asJWS()
    })

    describe('generateQR()', () => {
      it('should generate a single QR code data URL', async () => {
        const qrDataUrls = await qrGenerator.generateQR(validJWS)

        expect(qrDataUrls).toBeDefined()
        expect(Array.isArray(qrDataUrls)).toBe(true)
        expect(qrDataUrls).toHaveLength(1)
        expect(qrDataUrls[0]).toMatch(/^data:image\/png;base64,/)
      })

      it('should generate chunked QR codes when enabled and JWS is large', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100, // Very small size to force chunking
        })

        const qrDataUrls = await chunkedGenerator.generateQR(validJWS)

        expect(qrDataUrls).toBeDefined()
        expect(Array.isArray(qrDataUrls)).toBe(true)
        expect(qrDataUrls.length).toBeGreaterThan(1)

        // All should be valid data URLs
        for (const dataUrl of qrDataUrls) {
          expect(dataUrl).toMatch(/^data:image\/png;base64,/)
        }
      })

      it('should throw QRCodeError for invalid JWS characters', async () => {
        const invalidJWS = 'invalid-jws-with-unicode-€'

        await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow('Invalid character')
      })

      it('should use default configuration values', () => {
        const defaultGenerator = new QRCodeGenerator()

        expect(defaultGenerator.config.maxSingleQRSize).toBe(1195)
        expect(defaultGenerator.config.enableChunking).toBe(false)
      })

      it('should respect custom configuration values', () => {
        const customGenerator = new QRCodeGenerator({
          maxSingleQRSize: 2000,
          enableChunking: true,
          encodeOptions: {
            errorCorrectionLevel: 'H',
            scale: 8,
          },
        })

        expect(customGenerator.config.maxSingleQRSize).toBe(2000)
        expect(customGenerator.config.enableChunking).toBe(true)
        expect(customGenerator.config.encodeOptions?.errorCorrectionLevel).toBe('H')
        expect(customGenerator.config.encodeOptions?.scale).toBe(8)
      })

      it('should throw QRCodeError when chunking is required but disabled', async () => {
        const generator = new QRCodeGenerator({
          maxSingleQRSize: 10,
          enableChunking: false,
        })

        // Simple base64url-safe JWS-like string long enough to exceed maxSingleQRSize
        const longJWS = 'header.payload.signatureheader.payload.signature'

        await expect(generator.generateQR(longJWS)).rejects.toThrow(QRCodeError)
        await expect(generator.generateQR(longJWS)).rejects.toThrow('exceeds maxSingleQRSize')
      })

      it('should use default maxSingleQRSize when not provided in config', async () => {
        const generator = new QRCodeGenerator({
          enableChunking: true,
          // No maxSingleQRSize specified, should use default
        })

        // Generate a JWS that would fit in default size but exceed a small custom size
        const jws = 'a'.repeat(1000) // Shorter than default 1195

        const chunks = generator.chunkJWS(jws)
        expect(chunks).toHaveLength(1) // Should fit in single QR with default size
      })

      it('should auto-derive maxSingleQRSize from errorCorrectionLevel', async () => {
        // Test L level (default)
        const qrGeneratorL = new QRCodeGenerator()
        expect(qrGeneratorL.config.maxSingleQRSize).toBe(1195)

        // Test M level
        const qrGeneratorM = new QRCodeGenerator({
          encodeOptions: { errorCorrectionLevel: 'M' },
        })
        expect(qrGeneratorM.config.maxSingleQRSize).toBe(927)

        // Test Q level
        const qrGeneratorQ = new QRCodeGenerator({
          encodeOptions: { errorCorrectionLevel: 'Q' },
        })
        expect(qrGeneratorQ.config.maxSingleQRSize).toBe(670)

        // Test H level
        const qrGeneratorH = new QRCodeGenerator({
          encodeOptions: { errorCorrectionLevel: 'H' },
        })
        expect(qrGeneratorH.config.maxSingleQRSize).toBe(519)
      })

      it('should respect explicit maxSingleQRSize over auto-derivation', async () => {
        const customSize = 800
        const qrGenerator = new QRCodeGenerator({
          maxSingleQRSize: customSize,
          encodeOptions: { errorCorrectionLevel: 'H' }, // Would normally be 519
        })
        expect(qrGenerator.config.maxSingleQRSize).toBe(customSize)
      })

      it('should handle empty QR code data array', async () => {
        const generator = new QRCodeGenerator()

        const emptyQRData: string[] = []

        await expect(generator.scanQR(emptyQRData)).rejects.toThrow(QRCodeError)
        await expect(generator.scanQR(emptyQRData)).rejects.toThrow('No QR code data provided')
      })

      it('should handle undefined QR data in scanQR', async () => {
        const generator = new QRCodeGenerator()

        // Create a scenario that would trigger the undefined QR data check
        const qrDataWithUndefined = [undefined as unknown as string]

        await expect(generator.scanQR(qrDataWithUndefined)).rejects.toThrow(QRCodeError)
      })

      it('should accept custom encodeOptions and merge them with SMART Health Cards spec defaults', () => {
        const customGenerator = new QRCodeGenerator({
          encodeOptions: {
            errorCorrectionLevel: 'M',
            scale: 2,
            margin: 3,
            maskPattern: 2,
            version: 10,
          },
        })

        expect(customGenerator.config.encodeOptions).toEqual({
          errorCorrectionLevel: 'M', // From encodeOptions, overrides default 'L'
          scale: 2, // From encodeOptions, overrides default 4
          margin: 3, // From encodeOptions, overrides default 1
          maskPattern: 2, // From encodeOptions only
          version: 10, // From encodeOptions only
          color: {
            dark: '#000000ff', // Default dark color for SMART Health Cards
            light: '#ffffffff', // Default light color for SMART Health Cards
          },
        })
      })

      it('should use SMART Health Cards specification defaults', () => {
        const defaultGenerator = new QRCodeGenerator()

        // Test that buildEncodeOptions uses SMART Health Cards spec defaults
        const buildEncodeOptions = (defaultGenerator as any).buildEncodeOptions.bind(
          defaultGenerator
        )
        const mergedOptions = buildEncodeOptions()

        expect(mergedOptions).toEqual({
          errorCorrectionLevel: 'L', // Default error correction level from SMART Health Cards spec
          scale: 4, // Default scale
          margin: 1, // Default margin from SMART Health Cards spec
          color: {
            dark: '#000000ff', // Default dark color for SMART Health Cards
            light: '#ffffffff', // Default light color for SMART Health Cards
          },
          // version is not set by default - qrcode library auto-selects optimal settings
        })
      })

      it('should generate QR codes with custom encodeOptions applied', async () => {
        // Create a mock just for this test
        const mockToDataURL = vi.fn()

        // Return a simple PNG data URL string as qrcode library does
        mockToDataURL.mockResolvedValue('data:image/png;base64,AAA')

        // Mock the qr module for this test only
        vi.doMock('qrcode', () => ({
          toDataURL: mockToDataURL,
        }))

        // Use a simple test string
        const simpleJWS = 'header.payload.signature'

        const customGenerator = new QRCodeGenerator({
          encodeOptions: {
            errorCorrectionLevel: 'H', // Custom error correction level
            scale: 6, // Custom scale
            margin: 0, // No border
            version: 5, // Additional option
          },
        })

        const qrDataUrls = await customGenerator.generateQR(simpleJWS)

        // Verify the mock was called with correct parameters
        // The JWS gets encoded to numeric format per SMART Health Cards spec
        const expectedNumeric = '595652555669016752766366525501706058655271726956'
        expect(mockToDataURL).toHaveBeenCalledWith(
          [
            { data: new TextEncoder().encode('shc:/'), mode: 'byte' },
            { data: expectedNumeric, mode: 'numeric' },
          ],
          {
            errorCorrectionLevel: 'H',
            scale: 6,
            margin: 0,
            version: 5,
            color: {
              dark: '#000000ff',
              light: '#ffffffff',
            },
          }
        )

        // Verify the result
        expect(qrDataUrls).toBeDefined()
        expect(Array.isArray(qrDataUrls)).toBe(true)
        expect(qrDataUrls).toHaveLength(1)
        expect(qrDataUrls[0]).toMatch(/^data:image\/png;base64,/)

        // Clean up the mock for this test
        vi.doUnmock('qrcode')
      })
    })

    describe('scanQR()', () => {
      it('should decode a single QR code back to original JWS', async () => {
        // First generate QR code
        const qrDataUrls = await qrGenerator.generateQR(validJWS)
        expect(qrDataUrls).toHaveLength(1) // Ensure QR was generated

        // Extract the numeric data from the QR code content manually
        // Since we can't actually scan an image in tests, we'll simulate the process
        const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
        const qrContent = `shc:/${numericData}`

        // Decode back to JWS
        const decodedJWS = await qrGenerator.scanQR([qrContent])

        expect(decodedJWS).toBe(validJWS)
      })

      it('should decode chunked QR codes back to original JWS', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100, // Force chunking
        })

        // Simulate chunked QR content
        const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
        const chunkSize = 80 // Smaller than maxSingleQRSize minus header
        const chunks: string[] = []

        for (let i = 0; i < numericData.length; i += chunkSize) {
          chunks.push(numericData.substring(i, i + chunkSize))
        }

        const qrContents = chunks.map(
          (chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`
        )

        const decodedJWS = await qrGenerator.scanQR(qrContents)
        expect(decodedJWS).toBe(validJWS)
      })

      it('should throw QRCodeError for empty QR data', async () => {
        await expect(qrGenerator.scanQR([])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([])).rejects.toThrow('No QR code data provided')
      })

      it('should throw QRCodeError for invalid QR format', async () => {
        await expect(qrGenerator.scanQR(['invalid-qr-data'])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(['invalid-qr-data'])).rejects.toThrow(
          "Invalid QR code format. Expected 'shc:/' prefix"
        )
      })

      it('should throw QRCodeError for invalid chunked format', async () => {
        const invalidChunked = ['shc:/1/2', 'shc:/2/2/data'] // Missing data in first chunk

        await expect(qrGenerator.scanQR(invalidChunked)).rejects.toThrow(QRCodeError)
      })

      it("should throw QRCodeError when a chunk doesn't start with shc:/ prefix", async () => {
        const badPrefix = ['invalidprefix:/1/1/00', 'shc:/1/1/00']
        await expect(qrGenerator.scanQR(badPrefix)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(badPrefix)).rejects.toThrow(
          "Invalid chunked QR code format. Expected 'shc:/' prefix."
        )
      })

      it('should throw QRCodeError for chunked entries with missing parts', async () => {
        // parts length is 3 but one part empty => triggers missing parts branch
        await expect(qrGenerator.scanQR(['shc:/1//1234', 'shc:/2/2/5678'])).rejects.toThrow(
          QRCodeError
        )
        await expect(qrGenerator.scanQR(['shc:/1//1234', 'shc:/2/2/5678'])).rejects.toThrow(
          'Invalid chunked QR code format: missing parts'
        )

        await expect(qrGenerator.scanQR(['shc:/1/2/', 'shc:/2/2/1234'])).rejects.toThrow(
          QRCodeError
        )
        await expect(qrGenerator.scanQR(['shc:/1/2/', 'shc:/2/2/1234'])).rejects.toThrow(
          'Invalid chunked QR code format: missing parts'
        )
      })

      it('should throw QRCodeError for invalid chunk index or total in chunked QR', async () => {
        // index < 1
        await expect(qrGenerator.scanQR(['shc:/0/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          QRCodeError
        )
        await expect(qrGenerator.scanQR(['shc:/0/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          'Invalid chunk index or total in QR code'
        )

        // index > total
        await expect(qrGenerator.scanQR(['shc:/3/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          QRCodeError
        )
        await expect(qrGenerator.scanQR(['shc:/3/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          'Invalid chunk index or total in QR code'
        )

        // non-numeric index
        await expect(qrGenerator.scanQR(['shc:/a/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          QRCodeError
        )
        await expect(qrGenerator.scanQR(['shc:/a/2/12', 'shc:/2/2/34'])).rejects.toThrow(
          'Invalid chunk index or total in QR code'
        )
      })

      it('should throw QRCodeError for empty numeric payload in single QR', async () => {
        await expect(qrGenerator.scanQR(['shc:/'])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(['shc:/'])).rejects.toThrow(
          'Invalid numeric data: cannot parse digit pairs'
        )
      })

      it('should throw QRCodeError for missing chunks', async () => {
        const incompleteChunks = [
          'shc:/1/3/123456',
          'shc:/3/3/789012', // Missing chunk 2
        ]

        await expect(qrGenerator.scanQR(incompleteChunks)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(incompleteChunks)).rejects.toThrow(
          'Missing chunks. Expected 3, got 2'
        )
      })

      it('should throw QRCodeError for inconsistent chunk totals', async () => {
        const inconsistentChunks = [
          'shc:/1/2/123456',
          'shc:/2/3/789012', // Different total count
        ]

        await expect(qrGenerator.scanQR(inconsistentChunks)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(inconsistentChunks)).rejects.toThrow(
          'Inconsistent total chunk count'
        )
      })

      it('should throw QRCodeError for invalid numeric data', async () => {
        const invalidNumeric = 'shc:/12345' // Odd length

        await expect(qrGenerator.scanQR([invalidNumeric])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([invalidNumeric])).rejects.toThrow(
          'Invalid numeric data: must have even length'
        )
      })

      it('should throw QRCodeError for out-of-range digit pairs', async () => {
        const outOfRange = 'shc:/9999' // 99 > 77 (max value for 'z')

        await expect(qrGenerator.scanQR([outOfRange])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([outOfRange])).rejects.toThrow(
          "Invalid digit pair '99': value 99 exceeds maximum 77"
        )
      })

      it('should throw QRCodeError when total chunk count is inconsistent across inputs', async () => {
        const inconsistentTotals = ['shc:/1/2/1234', 'shc:/2/3/5678']
        await expect(qrGenerator.scanQR(inconsistentTotals)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(inconsistentTotals)).rejects.toThrow(
          'Inconsistent total chunk count across QR codes'
        )
      })

      it('should throw QRCodeError when chunk total is consistent but missing chunks', async () => {
        // totalChunks=3 but only 2 provided
        const missing = ['shc:/1/3/1111', 'shc:/3/3/2222']
        await expect(qrGenerator.scanQR(missing)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(missing)).rejects.toThrow(
          'Missing chunks. Expected 3, got 2'
        )
      })
    })

    describe('chunkJWS() public method', () => {
      it('should return single QR code string for small JWS', () => {
        const smallJWS = 'header.payload.signature'
        const chunks = qrGenerator.chunkJWS(smallJWS)

        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toMatch(/^shc:\/\d+$/)

        // Should be properly formatted with numeric data
        const numericData = qrGenerator.encodeJWSToNumeric(smallJWS)
        expect(chunks[0]).toBe(`shc:/${numericData}`)
      })

      it('should throw error for invalid JWS input', () => {
        expect(() => qrGenerator.chunkJWS('')).toThrow(QRCodeError)
        expect(() => qrGenerator.chunkJWS('')).toThrow('Invalid JWS: must be a non-empty string')

        expect(() => qrGenerator.chunkJWS(null as unknown as string)).toThrow(QRCodeError)
        expect(() => qrGenerator.chunkJWS(undefined as unknown as string)).toThrow(QRCodeError)
      })

      it('should produce chunks that can be reassembled correctly', () => {
        const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })

        const originalJWS = 'header.payload.verylongsignature'.repeat(10)
        const chunks = generator.chunkJWS(originalJWS)

        expect(chunks.length).toBeGreaterThan(1)

        // Extract numeric data from chunks and reassemble
        const numericParts = chunks.map(chunk => {
          const parts = chunk.split('/')
          return parts[parts.length - 1] // Get numeric data part
        })

        const reassembledNumeric = numericParts.join('')
        const reassembledJWS = generator.decodeNumericToJWS(reassembledNumeric)

        expect(reassembledJWS).toBe(originalJWS)
      })
    })

    describe('numeric encoding/decoding', () => {
      it('should correctly encode and decode all valid base64url characters', () => {
        const base64urlChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_='

        const encoded = qrGenerator.encodeJWSToNumeric(base64urlChars)
        const decoded = qrGenerator.decodeNumericToJWS(encoded)

        expect(decoded).toBe(base64urlChars)
      })

      it('should produce expected numeric values for known characters', () => {
        // Test specific character mappings
        const testCases = [
          { char: '-', expected: '00' }, // ASCII 45 - 45 = 0
          { char: 'A', expected: '20' }, // ASCII 65 - 45 = 20
          { char: 'a', expected: '52' }, // ASCII 97 - 45 = 52
          { char: 'z', expected: '77' }, // ASCII 122 - 45 = 77
          { char: '0', expected: '03' }, // ASCII 48 - 45 = 3
          { char: '9', expected: '12' }, // ASCII 57 - 45 = 12
        ]

        for (const testCase of testCases) {
          const encoded = qrGenerator.encodeJWSToNumeric(testCase.char)
          expect(encoded).toBe(testCase.expected)
        }
      })

      it('should handle round-trip encoding correctly', () => {
        // Use part of a real JWS header
        const jwtHeader = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9'

        const encoded = qrGenerator.encodeJWSToNumeric(jwtHeader)
        const decoded = qrGenerator.decodeNumericToJWS(encoded)

        expect(decoded).toBe(jwtHeader)
      })
    })

    describe('end-to-end QR workflow', () => {
      it('should handle complete QR generation and scanning workflow', async () => {
        // Generate QR codes
        const qrDataUrls = await qrGenerator.generateQR(validJWS)
        expect(qrDataUrls).toHaveLength(1)

        // Simulate scanning process (extract content from QR)
        const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
        const qrContent = `shc:/${numericData}`

        // Scan and decode
        const scannedJWS = await qrGenerator.scanQR([qrContent])

        // Should match original
        expect(scannedJWS).toBe(validJWS)

        // Should be verifiable
        const reader = new SmartHealthCardReader({
          publicKey: testPublicKeySPKI,
          enableQROptimization: false,
          strictReferences: true,
        })

        const verifiedHealthCard = await reader.fromJWS(scannedJWS)
        expect(verifiedHealthCard).toBeDefined()
        const verifiedBundle = await verifiedHealthCard.asBundle()
        expect(verifiedBundle).toEqual(createValidFHIRBundle())
      })

      it('should handle chunked QR workflow', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100,
        })

        // Generate chunked QR codes
        const qrDataUrls = await chunkedGenerator.generateQR(validJWS)
        expect(qrDataUrls.length).toBeGreaterThan(1)

        // Simulate chunked scanning
        const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
        const chunkSize = 80
        const chunks: string[] = []

        for (let i = 0; i < numericData.length; i += chunkSize) {
          chunks.push(numericData.substring(i, i + chunkSize))
        }

        const qrContents = chunks.map(
          (chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`
        )

        // Scan and decode
        const scannedJWS = await chunkedGenerator.scanQR(qrContents)
        expect(scannedJWS).toBe(validJWS)
      })
    })

    describe('Balanced Chunking Algorithm', () => {
      it('should create exactly balanced chunks', () => {
        const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })

        // 120 characters: ceil(120/50)=3 chunks, ceil(120/3)=40 each
        const testJWS = 'a'.repeat(120)
        const chunks = generator.chunkJWS(testJWS)

        expect(chunks).toHaveLength(3)

        const chunkSizes = chunks.map(chunk => {
          const parts = chunk.split('/')
          const numericPart = parts[parts.length - 1]
          return numericPart.length / 2 // Each pair of digits = 1 character
        })

        expect(chunkSizes).toEqual([40, 40, 40])
      })

      it('should handle uneven divisions correctly', () => {
        const generator = new QRCodeGenerator({ maxSingleQRSize: 50 })

        // 125 characters: ceil(125/50)=3 chunks, ceil(125/3)=42, so [42, 42, 41]
        const testJWS = 'b'.repeat(125)
        const chunks = generator.chunkJWS(testJWS)

        expect(chunks).toHaveLength(3)

        const chunkSizes = chunks.map(chunk => {
          const parts = chunk.split('/')
          const numericPart = parts[parts.length - 1]
          return numericPart.length / 2
        })

        expect(chunkSizes).toEqual([42, 42, 41])
      })

      it('should handle various division cases', () => {
        const generator = new QRCodeGenerator({ maxSingleQRSize: 10 })

        const testCases = [
          { size: 21, expectedSizes: [7, 7, 7] }, // ceil(21/10)=3, ceil(21/3)=7
          { size: 22, expectedSizes: [8, 8, 6] }, // ceil(22/10)=3, ceil(22/3)=8, then [8,8,6]
          { size: 30, expectedSizes: [10, 10, 10] }, // ceil(30/10)=3, ceil(30/3)=10
          { size: 31, expectedSizes: [8, 8, 8, 7] }, // ceil(31/10)=4, ceil(31/4)=8, then [8,8,8,7]
        ]

        testCases.forEach(({ size, expectedSizes }) => {
          const testJWS = 'x'.repeat(size)
          const chunks = generator.chunkJWS(testJWS)

          const chunkSizes = chunks.map(chunk => {
            const parts = chunk.split('/')
            const numericPart = parts[parts.length - 1]
            return numericPart.length / 2
          })

          expect(chunkSizes).toEqual(expectedSizes)
        })
      })
    })
  })

  describe('Compression Features', () => {
    let issuer: SmartHealthCardIssuer
    let reader: SmartHealthCardReader
    let validBundle: FHIRBundle
    let issuerConfig: SmartHealthCardConfig
    let readerConfig: SmartHealthCardReaderConfigParams

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(() => {
      validBundle = createValidFHIRBundle()
      issuerConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        expirationTime: null,
        enableQROptimization: false,
        strictReferences: true,
      }
      readerConfig = {
        publicKey: testPublicKeySPKI,
        enableQROptimization: false,
        strictReferences: true,
      }
      issuer = new SmartHealthCardIssuer(issuerConfig)
      reader = new SmartHealthCardReader(readerConfig)
    })

    it('should create compressed SMART Health Card', async () => {
      const healthCard = await issuer.issue(validBundle)
      const jws = healthCard.asJWS()

      expect(jws).toBeDefined()
      expect(typeof jws).toBe('string')

      // Should be a valid JWS format (3 parts separated by dots)
      const parts = jws.split('.')
      expect(parts).toHaveLength(3)

      // Check header to ensure compression flag is set
      const { decodeProtectedHeader } = await import('jose')
      const header = decodeProtectedHeader(jws)
      expect(header.zip).toBe('DEF')
    })

    it('should verify compressed SMART Health Card', async () => {
      const healthCard = await issuer.issue(validBundle)
      const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toBeDefined()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should handle round-trip compression and decompression', async () => {
      const healthCard = await issuer.issue(validBundle)
      const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS())
      const verifiedBundle = await verifiedHealthCard.asBundle()

      // Data should match original
      expect(verifiedBundle).toEqual(validBundle)
    })
  })

  describe('File Format Features', () => {
    let issuer: SmartHealthCardIssuer
    let reader: SmartHealthCardReader
    let validBundle: FHIRBundle
    let issuerConfig: SmartHealthCardConfig
    let readerConfig: SmartHealthCardReaderConfigParams

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(() => {
      validBundle = createValidFHIRBundle()
      issuerConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        expirationTime: null,
        enableQROptimization: false,
        strictReferences: true,
      }
      readerConfig = {
        publicKey: testPublicKeySPKI,
        enableQROptimization: false,
        strictReferences: true,
      }
      issuer = new SmartHealthCardIssuer(issuerConfig)
      reader = new SmartHealthCardReader(readerConfig)
    })

    it('should create file with JSON wrapper format', async () => {
      const healthCard = await issuer.issue(validBundle)
      const fileContent = await healthCard.asFileContent()

      expect(fileContent).toBeDefined()
      expect(typeof fileContent).toBe('string')

      // Should be valid JSON
      const parsed = JSON.parse(fileContent)
      expect(parsed).toHaveProperty('verifiableCredential')
      expect(Array.isArray(parsed.verifiableCredential)).toBe(true)
      expect(parsed.verifiableCredential).toHaveLength(1)

      // The JWS should be valid
      const jws = parsed.verifiableCredential[0]
      expect(typeof jws).toBe('string')
      expect(jws.split('.')).toHaveLength(3)
    })

    it('should verify file with JSON wrapper format', async () => {
      const healthCard = await issuer.issue(validBundle)
      const fileContent = await healthCard.asFileContent()
      const verifiedHealthCard = await reader.fromFileContent(fileContent)
      const verifiedBundle = await verifiedHealthCard.asBundle()

      expect(verifiedBundle).toBeDefined()
      expect(verifiedBundle).toEqual(validBundle)
    })

    it('should throw error for empty verifiableCredential array', async () => {
      const invalidFileContent = JSON.stringify({
        verifiableCredential: [],
      })

      await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(FileFormatError)
      await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(
        'File contains empty verifiableCredential array'
      )
    })

    it('should throw error for missing verifiableCredential property', async () => {
      const invalidFileContent = JSON.stringify({
        somethingElse: ['jws'],
      })

      await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(FileFormatError)
      await expect(reader.fromFileContent(invalidFileContent)).rejects.toThrow(
        'File does not contain expected verifiableCredential array'
      )
    })
  })

  describe('QR Optimization Features', () => {
    let fhirProcessor: FHIRBundleProcessor
    let validBundle: FHIRBundle

    beforeEach(() => {
      fhirProcessor = new FHIRBundleProcessor()
      validBundle = createValidFHIRBundle()
    })

    describe('SMART Health Cards QR optimization requirements', () => {
      let optimizedBundle: FHIRBundle

      beforeEach(() => {
        // Create a bundle with all the elements that should be removed
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
                text: {
                  status: 'generated',
                  div: '<div>Patient narrative</div>',
                },
                name: [
                  {
                    text: 'Display Name',
                    family: 'Doe',
                    given: ['John'],
                  },
                ],
                identifier: [
                  {
                    system: 'test',
                    value: '123',
                    type: {
                      coding: [
                        {
                          system: 'test',
                          code: 'test',
                          display: 'Test Display',
                        },
                      ],
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
                meta: {
                  security: [{ system: 'test', code: 'secure' }],
                },
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
                text: {
                  status: 'generated',
                  div: '<div>Condition narrative</div>',
                },
                subject: { reference: 'Patient/123' },
              },
            },
          ],
        }

        optimizedBundle = fhirProcessor.processForQR(bundleWithAllElements, true)
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
            // Should only have security field if meta exists
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
        // Check vaccineCode.text
        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        expect(immunization?.vaccineCode).not.toHaveProperty('text')

        // Check identifier.type.text
        const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
          ?.resource as Patient
        expect(patient?.identifier?.[0]?.type).not.toHaveProperty('text')
      })

      it('should remove Coding.display elements', () => {
        // Check vaccineCode.coding.display
        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        immunization?.vaccineCode?.coding?.forEach(coding => {
          expect(coding).not.toHaveProperty('display')
        })

        // Check identifier.type.coding.display
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
                generalPractitioner: [
                  {
                    reference: 'Practitioner/456',
                    display: 'Display Name', // This should be preserved
                  },
                ],
              },
            },
            {
              fullUrl: 'https://example.com/base/Practitioner/456',
              resource: {
                resourceType: 'Practitioner',
                id: '456',
              },
            },
          ],
        }

        const optimized = fhirProcessor.processForQR(bundleWithDisplayFields, true)
        const patient = optimized.entry?.[0]?.resource as Patient

        // Display in generalPractitioner should be preserved
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
                generalPractitioner: [
                  {
                    reference: 'Practitioner/456', // Missing reference
                  },
                ],
              },
            },
          ],
        }

        expect(() => fhirProcessor.processForQR(bundleWithDisplayFields, true)).toThrow(
          'Reference "Practitioner/456" not found in bundle resources'
        )
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
                generalPractitioner: [
                  {
                    reference: 'Practitioner/456', // Missing reference
                  },
                ],
              },
            },
          ],
        }

        const optimized = fhirProcessor.processForQR(bundleWithDisplayFields, false)
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
                name: null as any, // Will be removed
                identifier: [] as any, // Will be removed
                telecom: undefined as any, // Will be removed
                birthDate: '1990-01-01', // Will be preserved
              },
            },
          ],
        }

        const optimized = fhirProcessor.processForQR(bundleWithNullValues, true)
        const patient = optimized.entry?.[0]?.resource as Patient

        // null, undefined, and empty arrays should be removed
        expect(patient).not.toHaveProperty('name')
        expect(patient).not.toHaveProperty('identifier')
        expect(patient).not.toHaveProperty('telecom')
        // Valid properties should be preserved
        expect(patient.birthDate).toBe('1990-01-01')
        // id should be removed
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

        const optimized = fhirProcessor.processForQR(bundleWithIds, true)

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
            resource: {
              resourceType: 'Patient',
              id: 'patient-id',
              name: [{ family: 'Doe' }],
            },
          },
        ],
      }

      const optimized = fhirProcessor.processForQR(bundleWithRootId, true)

      // Bundle root id should be removed
      expect(optimized).not.toHaveProperty('id')

      // Resource-level ids are handled by existing tests; ensure entry still present
      expect(optimized.entry).toBeDefined()
      expect(optimized.entry?.length).toBe(1)
    })

    it('should create SmartHealthCard with QR optimization enabled', async () => {
      const config: SmartHealthCardConfigParams = {
        issuer: 'https://example.com/issuer',
        privateKey: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`,
        publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`,
        expirationTime: null,
        // enableQROptimization and strictReferences are true by default
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

      // Verify the optimized bundle can still be verified
      const verifiedHealthCard = await reader.fromJWS(jws)
      expect(verifiedHealthCard).toBeDefined()

      // Check that optimization was applied by looking at the bundle structure
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
      const config: SmartHealthCardConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`,
        publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`,
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

      // Essential data should be preserved
      const optimizedBundle = await verifiedHealthCard.asBundle()
      expect(optimizedBundle.resourceType).toBe('Bundle')
      expect(optimizedBundle.type).toBe('collection')
      expect(optimizedBundle.entry).toHaveLength(validBundle.entry?.length || 0)

      // Resources should still have their core data
      if (optimizedBundle.entry && validBundle.entry) {
        for (let i = 0; i < optimizedBundle.entry.length; i++) {
          const optimizedResource = optimizedBundle.entry[i].resource
          const originalResource = validBundle.entry[i].resource

          if (optimizedResource && originalResource) {
            expect(optimizedResource.resourceType).toBe(originalResource.resourceType)
            // Other essential fields should be preserved (exact comparison depends on optimization rules)
          }
        }
      }
    })
  })

  describe('Error Classes', () => {
    describe('SmartHealthCardError', () => {
      it('should create error with message and code', () => {
        const error = new SmartHealthCardError('Test error', 'TEST_CODE')

        expect(error).toBeInstanceOf(Error)
        expect(error.name).toBe('SmartHealthCardError')
        expect(error.message).toBe('Test error')
        expect(error.code).toBe('TEST_CODE')
      })
    })

    describe('InvalidBundleReferenceError', () => {
      it('should create invalid bundle reference error', () => {
        const error = new InvalidBundleReferenceError('Patient/123')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('InvalidBundleReferenceError')
        expect(error.message).toBe('Patient/123')
        expect(error.code).toBe('INVALID_BUNDLE_REFERENCE_ERROR')
      })
    })

    describe('FhirValidationError', () => {
      it('should create FHIR validation error', () => {
        const error = new FhirValidationError('FHIR validation failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('FhirValidationError')
        expect(error.message).toBe('FHIR validation failed')
        expect(error.code).toBe('FHIR_VALIDATION_ERROR')
      })
    })

    describe('JWSError', () => {
      it('should create JWS error', () => {
        const error = new JWSError('JWS processing failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('JWSError')
        expect(error.message).toBe('JWS processing failed')
        expect(error.code).toBe('JWS_ERROR')
      })
    })

    describe('QRCodeError', () => {
      it('should create QR code error', () => {
        const error = new QRCodeError('QR processing failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('QRCodeError')
        expect(error.message).toBe('QR processing failed')
        expect(error.code).toBe('QR_CODE_ERROR')
      })
    })

    describe('FileFormatError', () => {
      it('should create file format error', () => {
        const error = new FileFormatError('Invalid file format')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('FileFormatError')
        expect(error.message).toBe('Invalid file format')
        expect(error.code).toBe('FILE_FORMAT_ERROR')
      })
    })

    describe('VerificationError', () => {
      it('should create verification error', () => {
        const error = new VerificationError('Verification failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('VerificationError')
        expect(error.message).toBe('Verification failed')
        expect(error.code).toBe('VERIFICATION_ERROR')
      })
    })
  })
})
