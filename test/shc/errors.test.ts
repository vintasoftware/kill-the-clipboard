import { describe, expect, it } from 'vitest'
import {
  FhirValidationError,
  FileFormatError,
  InvalidBundleReferenceError,
  JWSError,
  QRCodeError,
  SmartHealthCardError,
  VerificationError,
} from '@/index'

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
