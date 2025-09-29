import { describe, expect, it } from 'vitest'
import {
  BundleValidationError,
  CredentialValidationError,
  ExpirationError,
  FileFormatError,
  InvalidBundleReferenceError,
  JWSError,
  PayloadValidationError,
  QRCodeError,
  SHCError,
  SignatureVerificationError,
  VerificationError,
} from '@/index'

describe('Error Classes', () => {
  describe('SHCError', () => {
    it('should create error with message and code', () => {
      const error = new SHCError('Test error', 'TEST_CODE')
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('SHCError')
      expect(error.message).toBe('Test error')
      expect(error.code).toBe('TEST_CODE')
    })
  })

  describe('InvalidBundleReferenceError', () => {
    it('should create invalid bundle reference error', () => {
      const error = new InvalidBundleReferenceError('Patient/123')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('InvalidBundleReferenceError')
      expect(error.message).toBe('Patient/123')
      expect(error.code).toBe('INVALID_BUNDLE_REFERENCE_ERROR')
    })
  })

  describe('CredentialValidationError', () => {
    it('should create FHIR validation error', () => {
      const error = new CredentialValidationError('FHIR validation failed')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('CredentialValidationError')
      expect(error.message).toBe('FHIR validation failed')
      expect(error.code).toBe('FAILED_VALIDATION')
    })
  })

  describe('JWSError', () => {
    it('should create JWS error', () => {
      const error = new JWSError('JWS processing failed')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('JWSError')
      expect(error.message).toBe('JWS processing failed')
      expect(error.code).toBe('JWS_ERROR')
    })
  })

  describe('QRCodeError', () => {
    it('should create QR code error', () => {
      const error = new QRCodeError('QR processing failed')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('QRCodeError')
      expect(error.message).toBe('QR processing failed')
      expect(error.code).toBe('QR_CODE_ERROR')
    })
  })

  describe('FileFormatError', () => {
    it('should create file format error', () => {
      const error = new FileFormatError('Invalid file format')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('FileFormatError')
      expect(error.message).toBe('Invalid file format')
      expect(error.code).toBe('FILE_FORMAT_ERROR')
    })
  })

  describe('VerificationError', () => {
    it('should create verification error', () => {
      const error = new VerificationError('Verification failed')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('VerificationError')
      expect(error.message).toBe('Verification failed')
      expect(error.code).toBe('VERIFICATION_ERROR')
    })
  })

  describe('SignatureVerificationError', () => {
    it('should create signature verification error with bad-signature code', () => {
      const error = new SignatureVerificationError('Invalid signature')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('SignatureVerificationError')
      expect(error.message).toBe('Invalid signature')
      expect(error.code).toBe('BAD_SIGNATURE')
    })
  })

  describe('ExpirationError', () => {
    it('should create expiration error with expired code', () => {
      const error = new ExpirationError('Health card has expired')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('ExpirationError')
      expect(error.message).toBe('Health card has expired')
      expect(error.code).toBe('EXPIRED')
    })
  })

  describe('PayloadValidationError', () => {
    it('should create payload validation error with failed-validation code', () => {
      const error = new PayloadValidationError('Missing issuer field')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('PayloadValidationError')
      expect(error.message).toBe('Missing issuer field')
      expect(error.code).toBe('FAILED_VALIDATION')
    })
  })

  describe('BundleValidationError', () => {
    it('should create bundle validation error with failed-validation code', () => {
      const error = new BundleValidationError('Invalid FHIR Bundle structure')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('BundleValidationError')
      expect(error.message).toBe('Invalid FHIR Bundle structure')
      expect(error.code).toBe('FAILED_VALIDATION')
    })
  })

  describe('CredentialValidationError', () => {
    it('should create credential validation error with failed-validation code', () => {
      const error = new CredentialValidationError('Invalid verifiable credential')
      expect(error).toBeInstanceOf(SHCError)
      expect(error.name).toBe('CredentialValidationError')
      expect(error.message).toBe('Invalid verifiable credential')
      expect(error.code).toBe('FAILED_VALIDATION')
    })
  })
})
