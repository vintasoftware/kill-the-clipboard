// Error Classes for SMART Health Cards

/**
 * Base error class for SMART Health Card operations.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class SHCError extends Error {
  constructor(
    message: string,
    /** Error code for programmatic handling. */
    public readonly code: string
  ) {
    super(message)
    this.name = 'SHCError'
  }
}

/**
 * Error thrown when JWT/JWS processing fails.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class JWSError extends SHCError {
  constructor(message: string) {
    super(message, 'JWS_ERROR')
    this.name = 'JWSError'
  }
}

/**
 * Error thrown when QR code processing fails.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class QRCodeError extends SHCError {
  constructor(message: string) {
    super(message, 'QR_CODE_ERROR')
    this.name = 'QRCodeError'
  }
}

/**
 * Error thrown when a bundle reference cannot be resolved.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class InvalidBundleReferenceError extends SHCError {
  constructor(message: string) {
    super(message, 'INVALID_BUNDLE_REFERENCE_ERROR')
    this.name = 'InvalidBundleReferenceError'
  }
}

/**
 * Error thrown when file format is invalid or cannot be parsed.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class FileFormatError extends SHCError {
  constructor(message: string) {
    super(message, 'FILE_FORMAT_ERROR')
    this.name = 'FileFormatError'
  }
}

/**
 * Error thrown when SMART Health Card verification fails unexpectedly.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class VerificationError extends SHCError {
  constructor(message: string) {
    super(message, 'VERIFICATION_ERROR')
    this.name = 'VerificationError'
  }
}

/**
 * Error thrown when JWT/JWS signature verification fails.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class SignatureVerificationError extends SHCError {
  constructor(message: string) {
    super(message, 'BAD_SIGNATURE')
    this.name = 'SignatureVerificationError'
  }
}

/**
 * Error thrown when a SMART Health Card has expired.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class ExpirationError extends SHCError {
  constructor(message: string) {
    super(message, 'EXPIRED')
    this.name = 'ExpirationError'
  }
}

/**
 * Error thrown when JWT payload validation fails due to missing or invalid fields.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class PayloadValidationError extends SHCError {
  constructor(message: string) {
    super(message, 'FAILED_VALIDATION')
    this.name = 'PayloadValidationError'
  }
}

/**
 * Error thrown when FHIR Bundle structure validation fails due to missing or invalid fields.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class BundleValidationError extends SHCError {
  constructor(message: string) {
    super(message, 'FAILED_VALIDATION')
    this.name = 'BundleValidationError'
  }
}

/**
 * Error thrown when Verifiable Credential validation fails due to missing or invalid fields.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class CredentialValidationError extends SHCError {
  constructor(message: string) {
    super(message, 'FAILED_VALIDATION')
    this.name = 'CredentialValidationError'
  }
}

/**
 * Error thrown when SHCReader configuration is invalid.
 *
 * @public
 * @group SHC
 * @category Errors
 */
export class SHCReaderConfigError extends SHCError {
  constructor(message: string) {
    super(message, 'INVALID_CONFIGURATION')
    this.name = 'SHCReaderConfigError'
  }
}
