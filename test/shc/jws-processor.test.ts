// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to check validation errors
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FHIRBundle,
  JWSError,
  JWSProcessor,
  type SmartHealthCardJWT,
  type VerifiableCredential,
  VerifiableCredentialProcessor,
} from '@/index'
import { createValidFHIRBundle, testPrivateKeyPKCS8, testPublicKeySPKI } from '../helpers'

describe('JWSProcessor', () => {
  let processor: JWSProcessor
  let validBundle: FHIRBundle
  let vcProcessor: VerifiableCredentialProcessor
  let validVC: VerifiableCredential
  let validJWTPayload: SmartHealthCardJWT

  beforeEach(async () => {
    processor = new JWSProcessor()
    validBundle = createValidFHIRBundle()
    vcProcessor = new VerifiableCredentialProcessor()
    validVC = vcProcessor.create(validBundle)

    const now = Math.floor(Date.now() / 1000)
    validJWTPayload = {
      iss: 'https://example.com/issuer',
      nbf: now,
      exp: now + 3600,
      vc: validVC.vc,
    }
  })

  describe('sign()', () => {
    it('should sign a valid JWT payload', async () => {
      const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)

      expect(jws).toBeDefined()
      expect(typeof jws).toBe('string')

      const parts = jws.split('.')
      expect(parts).toHaveLength(3)

      const { decodeProtectedHeader, importSPKI, exportJWK, calculateJwkThumbprint } = await import(
        'jose'
      )
      const header = decodeProtectedHeader(jws)
      expect(header.alg).toBe('ES256')

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

      const parts = jws.split('.')
      expect(parts).toHaveLength(3)

      const verified = await processor.verify(jws, publicKeyCrypto)
      expect(verified.iss).toBe(validJWTPayload.iss)
      expect(verified.nbf).toBe(validJWTPayload.nbf)
    })

    it('should throw JWSError for invalid payload', async () => {
      const invalidPayload = {
        nbf: Math.floor(Date.now() / 1000),
        vc: validVC.vc,
      } as any

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
      invalidPayload.exp = invalidPayload.nbf - 1000

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
      await expect(processor.verify(null as unknown as string, testPublicKeySPKI)).rejects.toThrow(
        JWSError
      )
      await expect(processor.verify(123 as unknown as string, testPublicKeySPKI)).rejects.toThrow(
        JWSError
      )
    })

    it('should throw JWSError for wrong public key', async () => {
      const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, testPublicKeySPKI)
      await expect(processor.verify(jws, 'wrong-public-key')).rejects.toThrow(JWSError)
    })

    it('should verify an uncompressed JWS (no zip header)', async () => {
      const jws = await processor.sign(
        { ...validJWTPayload },
        testPrivateKeyPKCS8,
        testPublicKeySPKI,
        { enableCompression: false }
      )
      const verifiedPayload = await processor.verify(jws, testPublicKeySPKI)
      expect(verifiedPayload.iss).toBe(validJWTPayload.iss)
      expect(verifiedPayload.vc).toEqual(validJWTPayload.vc)
    })

    it('should reject expired JWS by default', async () => {
      const now = Math.floor(Date.now() / 1000)
      const expiredPayload: SmartHealthCardJWT = {
        iss: 'https://example.com/issuer',
        nbf: now - 7200,
        exp: now - 3600,
        vc: validVC.vc,
      }
      const jws = await processor.sign(expiredPayload, testPrivateKeyPKCS8, testPublicKeySPKI)

      await expect(processor.verify(jws, testPublicKeySPKI)).rejects.toThrow(JWSError)
      await expect(processor.verify(jws, testPublicKeySPKI)).rejects.toThrow(
        'SMART Health Card has expired'
      )
    })

    it('should allow skipping expiration verification when option set', async () => {
      const now = Math.floor(Date.now() / 1000)
      const expiredPayload: SmartHealthCardJWT = {
        iss: 'https://example.com/issuer',
        nbf: now - 7200,
        exp: now - 3600,
        vc: validVC.vc,
      }
      const jws = await processor.sign(expiredPayload, testPrivateKeyPKCS8, testPublicKeySPKI)

      const verified = await processor.verify(jws, testPublicKeySPKI, { verifyExpiration: false })
      expect(verified.iss).toBe(expiredPayload.iss)
      expect(verified.exp).toBe(expiredPayload.exp)
    })
  })

  describe('validateJWTPayload() private method validation', () => {
    it('should validate payload structure through sign method', async () => {
      const testCases = [
        {
          payload: { iss: 123, nbf: Date.now(), vc: validVC.vc },
          error: "'iss' (issuer) is required and must be a string",
        },
        {
          payload: { iss: 'test', nbf: 'invalid', vc: validVC.vc },
          error: "'nbf' (not before) is required and must be a number",
        },
        {
          payload: {
            iss: 'test',
            nbf: Date.now(),
            exp: 'invalid',
            vc: validVC.vc,
          },
          error: "'exp' (expiration) must be a number if provided",
        },
        {
          payload: { iss: 'test', nbf: Date.now() },
          error: "'vc' (verifiable credential) is required and must be an object",
        },
      ] as const

      for (const testCase of testCases) {
        await expect(
          processor.sign(testCase.payload as any, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(testCase.payload as any, testPrivateKeyPKCS8, testPublicKeySPKI)
        ).rejects.toThrow(testCase.error)
      }
    })
  })
})
