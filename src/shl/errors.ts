// Error Classes for Smart Health Links

/**
 * Base error class for Smart Health Links operations.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLError extends Error {
  /** Error code for programmatic handling. */
  public code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SHLError'
    this.code = code
  }
}

/**
 * Error thrown when SHL manifest operations fail.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLManifestError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_MANIFEST_ERROR')
    this.name = 'SHLManifestError'
  }
}

/**
 * Error thrown when SHL network operations fail.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLNetworkError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_NETWORK_ERROR')
    this.name = 'SHLNetworkError'
  }
}

/**
 * Error thrown when SHL format parsing fails.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLFormatError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_FORMAT_ERROR')
    this.name = 'SHLFormatError'
  }
}

/**
 * Error thrown when SHL authentication fails.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLAuthError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_AUTH_ERROR')
    this.name = 'SHLAuthError'
  }
}

/**
 * Error thrown when SHL passcode is invalid.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLInvalidPasscodeError extends SHLAuthError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_INVALID_PASSCODE_ERROR'
    this.name = 'SHLInvalidPasscodeError'
  }
}

/**
 * Error thrown when SHL resolution fails.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLResolveError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_RESOLVE_ERROR')
    this.name = 'SHLResolveError'
  }
}

/**
 * Error thrown when SHL decryption fails.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLDecryptionError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_DECRYPTION_ERROR'
    this.name = 'SHLDecryptionError'
  }
}

/**
 * Error thrown when SHL manifest is not found.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLManifestNotFoundError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_MANIFEST_NOT_FOUND_ERROR'
    this.name = 'SHLManifestNotFoundError'
  }
}

/**
 * Error thrown when SHL manifest requests are rate limited.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLManifestRateLimitError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_RATE_LIMIT_ERROR'
    this.name = 'SHLManifestRateLimitError'
  }
}

/**
 * Error thrown when SHL has expired.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLExpiredError extends SHLResolveError {
  constructor(message: string) {
    super(message)
    this.code = 'SHL_EXPIRED_ERROR'
    this.name = 'SHLExpiredError'
  }
}

/**
 * Error thrown when SHL viewer cannot be created or
 * invalid parameters are provided during resolution.
 *
 * @public
 * @group SHL
 * @category Errors
 */
export class SHLViewerError extends SHLError {
  constructor(message: string) {
    super(message, 'SHL_VIEWER_ERROR')
    this.name = 'SHLViewerError'
  }
}
