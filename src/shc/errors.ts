// Error Classes for SMART Health Cards

/**
 * Base error class for SMART Health Card operations.
 *
 * @public
 * @category Errors
 */
export class SmartHealthCardError extends Error {
  constructor(
    message: string,
    /** Error code for programmatic handling. */
    public readonly code: string
  ) {
    super(message)
    this.name = 'SmartHealthCardError'
  }
}

/**
 * Error thrown when FHIR Bundle validation fails.
 *
 * @public
 * @category Errors
 */
export class FhirValidationError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'FHIR_VALIDATION_ERROR')
    this.name = 'FhirValidationError'
  }
}

/**
 * Error thrown when JWT/JWS processing fails.
 *
 * @public
 * @category Errors
 */
export class JWSError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'JWS_ERROR')
    this.name = 'JWSError'
  }
}

/**
 * Error thrown when QR code processing fails.
 *
 * @public
 * @category Errors
 */
export class QRCodeError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'QR_CODE_ERROR')
    this.name = 'QRCodeError'
  }
}

/**
 * Error thrown when a bundle reference cannot be resolved.
 *
 * @public
 * @category Errors
 */
export class InvalidBundleReferenceError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'INVALID_BUNDLE_REFERENCE_ERROR')
    this.name = 'InvalidBundleReferenceError'
  }
}

/**
 * Error thrown when file format is invalid or cannot be parsed.
 *
 * @public
 * @category Errors
 */
export class FileFormatError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'FILE_FORMAT_ERROR')
    this.name = 'FileFormatError'
  }
}

/**
 * Error thrown when SMART Health Card verification fails unexpectedly.
 *
 * @public
 * @category Errors
 */
export class VerificationError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'VERIFICATION_ERROR')
    this.name = 'VerificationError'
  }
}
