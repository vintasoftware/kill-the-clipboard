import { base64url } from 'jose'
import QRCode from 'qrcode'
import { SHLError, SHLFormatError } from './errors.js'
import type { SHLFlag, SHLinkPayloadV1, SHLQREncodeParams } from './types.js'

/**
 * Immutable SHL class representing a Smart Health Link payload and URI.
 *
 * This class handles the SHLink "pointer" - the payload containing url, key, flags, etc.
 * It provides methods to generate SHLink URIs and access payload properties.
 * Use {@link SHLManifestBuilder} to manage the manifest and files referenced by this SHL.
 *
 * Smart Health Links enable secure sharing of health data through encrypted links.
 * The SHL contains a manifest URL and encryption key, allowing recipients to fetch
 * and decrypt the shared health information.
 *
 * @example
 * ```typescript
 * // Generate a new SHL
 * const shl = SHL.generate({
 *   baseManifestURL: 'https://shl.example.org/manifests/',
 *   manifestPath: '/manifest.json',
 *   expirationDate: new Date('2024-12-31'),
 *   flag: 'P',
 *   label: 'COVID-19 Vaccination Record'
 * });
 *
 * // Generate the SHLink URI
 * const uri = shl.toURI();
 * console.log(uri); // shlink:/eyJ1cmwiOi...
 * ```
 *
 * @public
 * @group SHL
 * @category High-Level API
 */
export class SHL {
  private readonly _manifestURL: string
  private readonly _key: string
  private readonly _expirationDate: Date | undefined
  private readonly _flag: SHLFlag | undefined
  private readonly _label: string | undefined
  private readonly v: 1 = 1

  /**
   * Private constructor for internal instantiation.
   *
   * Use {@link SHL.generate} to create new instances or {@link SHL.fromPayload}
   * to reconstruct from existing payloads.
   *
   * @param core - Core SHL properties
   */
  private constructor(core: {
    manifestURL: string
    key: string
    expirationDate?: Date
    flag?: SHLFlag
    label?: string
  }) {
    this._manifestURL = core.manifestURL
    this._key = core.key
    this._expirationDate = core.expirationDate
    this._flag = core.flag
    this._label = core.label
  }

  /**
   * Create an immutable SHL representing a Smart Health Link payload and URI.
   *
   * The SHL payload contains a cryptographically secure manifest URL and encryption key.
   * The manifest URL is constructed as: `${baseManifestURL}/${entropy}/${manifestPath}` where `entropy` is a
   * 32-byte base64url string (43 chars). The encryption key is a separate 32-byte base64url string (43 chars)
   * placed in the SHLink payload `key`.
   *
   * @param params.baseManifestURL - Base URL for constructing manifest URLs (e.g., 'https://shl.example.org/manifests/')
   * @param params.manifestPath - Optional manifestPath for constructing manifest URLs (e.g., '/manifest.json')
   * @param params.expirationDate - Optional expiration date for the SHLink. When set, fills the `exp` field in the SHLink payload with Unix timestamp.
   * @param params.flag - Optional flag for the SHLink (see {@link SHLFlag})
   * @param params.label - Optional short description of the shared data. Maximum 80 characters.
   * @returns New SHL instance with generated full manifest URL and encryption key
   * @throws {@link SHLFormatError} When label exceeds 80 characters
   *
   * @example
   * ```typescript
   * // SHL with expiration and passcode protection
   * const shl = SHL.generate({
   *   baseManifestURL: 'https://shl.example.org',
   *   manifestPath: '/manifest.json',
   *   expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
   *   flag: 'P',
   *   label: 'Lab Results - Valid for 30 days'
   * });
   * ```
   */
  static generate(params: {
    baseManifestURL: string
    manifestPath?: string
    expirationDate?: Date
    flag?: SHLFlag
    label?: string
  }): SHL {
    const expirationDate = params.expirationDate
    const flag = params.flag
    const label = params.label

    // Validate label length
    if (label && label.length > 80) {
      throw new SHLFormatError('Label must be 80 characters or less')
    }

    const baseManifestURL = params.baseManifestURL.replace(/\/$/, '')
    const manifestPath = params.manifestPath?.replace(/^\//, '') ?? ''
    // Generate 32 random bytes for manifest path (43 chars base64url-encoded)
    const pathEntropy = new Uint8Array(32)
    crypto.getRandomValues(pathEntropy)
    const manifestURL = `${baseManifestURL}/${base64url.encode(pathEntropy)}/${manifestPath}`

    // Generate 32 random bytes for encryption key (43 chars base64url-encoded)
    const keyEntropy = new Uint8Array(32)
    crypto.getRandomValues(keyEntropy)
    const key = base64url.encode(keyEntropy)

    const args: {
      manifestURL: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      manifestURL,
      key,
    }
    if (expirationDate !== undefined) args.expirationDate = expirationDate
    if (flag !== undefined) args.flag = flag
    if (label !== undefined) args.label = label
    return new SHL(args)
  }

  /**
   * Generate the SHLink URI following the Smart Health Links specification.
   *
   * Creates a `shlink:/` URI with base64url-encoded JSON payload containing
   * the manifest URL, encryption key, and optional metadata (expiration, flags, label).
   *
   * @returns SHLink URI string in format `shlink:/<base64url-encoded-payload>`
   *
   * @example
   * ```typescript
   * // SHL with expiration and passcode protection
   * const shl = SHL.generate({
   *   baseManifestURL: 'https://shl.example.org',
   *   manifestPath: '/manifest.json',
   *   expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
   *   flag: 'P',
   *   label: 'Lab Results - Valid for 30 days'
   * });
   * // Generate the SHLink URI
   * const uri = shl.toURI();
   * // Returns: shlink:/eyJ1cmwiOiJodHRwczovL3NobC5leGFtcGxlLm9yZy9tYW5pZmVzdHMvLi4uXCIsXCJrZXlcIjpcIi4uLlwiLFwidlwiOjF9
   * ```
   */
  toURI(): string {
    const payload = this.payload
    const payloadJson = JSON.stringify(payload)
    const payloadB64u = base64url.encode(new TextEncoder().encode(payloadJson))
    return `shlink:/${payloadB64u}`
  }

  /**
   * Get the full manifest URL that servers must handle.
   *
   * Returns the complete HTTPS URL where the manifest can be fetched via POST request
   * as specified in the Smart Health Links protocol.
   *
   * @returns Complete manifest URL (e.g., 'https://shl.example.org/manifests/abc123.../manifest.json')
   */
  get url(): string {
    return this._manifestURL
  }

  /**
   * Get the base64url-encoded encryption key for files.
   *
   * Returns the 256-bit symmetric encryption key used for JWE file encryption,
   * encoded as base64url (always 43 characters).
   *
   * @returns Base64url-encoded encryption key (43 characters)
   */
  get key(): string {
    return this._key
  }

  /**
   * Get the expiration date as Unix timestamp if set.
   *
   * Returns the expiration time in seconds since Unix epoch (1970-01-01),
   * suitable for use in the SHLink payload `exp` field.
   *
   * @returns Unix timestamp in seconds, or undefined if no expiration set
   */
  get exp(): number | undefined {
    return this._expirationDate ? Math.floor(this._expirationDate.getTime() / 1000) : undefined
  }

  /**
   * Get the expiration date as a Date object if set.
   *
   * @returns Date object representing expiration time, or undefined if no expiration set
   */
  get expirationDate(): Date | undefined {
    return this._expirationDate
  }

  /**
   * Get the SHL flags if set.
   *
   * Returns the flag string indicating SHL capabilities.
   *
   * @returns Flag string, or undefined if no flags set
   */
  get flag(): SHLFlag | undefined {
    return this._flag
  }

  /**
   * Get the human-readable label if set.
   *
   * Returns the optional short description of the shared data.
   * Maximum length is 80 characters as per SHL specification.
   *
   * @returns Label string, or undefined if no label set
   */
  get label(): string | undefined {
    return this._label
  }

  /**
   * Get the SHL payload version.
   *
   * Always returns 1 for the current Smart Health Links v1 specification.
   *
   * @returns Version number (always 1)
   */
  get version(): 1 {
    return this.v
  }

  /**
   * Check if this SHL requires a passcode for access.
   *
   * Returns true if the SHL has the 'P' flag, indicating that a passcode
   * must be provided when fetching the manifest.
   *
   * @returns True if passcode is required, false otherwise
   */
  get requiresPasscode(): boolean {
    return this._flag?.includes('P') ?? false
  }

  /**
   * Check if this SHL supports long-term access with updates.
   *
   * Returns true if the SHL has the 'L' flag, indicating that clients
   * may poll the manifest URL for updates over time.
   *
   * @returns True if long-term access is supported, false otherwise
   */
  get isLongTerm(): boolean {
    return this._flag?.includes('L') ?? false
  }

  /**
   * Check if this SHL is a direct-file link (bypasses manifest).
   *
   * Returns true if the SHL has the 'U' flag, indicating that the `url` points
   * directly to a single encrypted file retrievable via GET.
   */
  get isDirectFile(): boolean {
    return this._flag?.includes('U') ?? false
  }

  /**
   * Get the complete SHL payload object for serialization.
   *
   * Returns the payload structure that gets base64url-encoded in the SHLink URI.
   * Includes all fields: url, key, version, and optional exp, flag, label.
   *
   * @returns SHLink payload object conforming to v1 specification
   */
  get payload(): SHLinkPayloadV1 {
    const payload: SHLinkPayloadV1 = {
      url: this.url,
      key: this.key,
      v: this.v,
    }
    if (this.exp) {
      payload.exp = this.exp
    }
    if (this._flag) {
      payload.flag = this._flag
    }
    if (this._label) {
      payload.label = this._label
    }
    return payload
  }

  /**
   * Generate a QR code as a Data URL for the SHLink URI.
   *
   * Creates a QR code image encoded as a base64 Data URL that can be used
   * directly in HTML img tags or displayed in applications.
   *
   * @param params - Optional QR code generation options. The object can contain:
   *   - `viewerURL`: URL of the SHL viewer to prefix the QR code like https://example.org/viewer#shlink:/... (default: no URL)
   *   - `width`: Width of the QR code image in pixels (default: 256)
   *   - `margin`: Margin around the QR code in modules (default: 1)
   *   - `errorCorrectionLevel`: Error correction level 'L', 'M', 'Q', or 'H' (default: 'M', per spec)
   *   - `color`: Color options for dark and light modules
   * @returns Promise that resolves to a Data URL string
   *
   * @example
   * ```typescript
   * const shl = SHL.generate({
   *   baseManifestURL: 'https://shl.example.org',
   *   manifestPath: '/manifest.json'
   * });
   *
   * const qrCodeDataURL = await shl.asQR();
   * // Use in HTML: <img src={qrCodeDataURL} alt="SHL QR Code" />
   *
   * // With custom options
   * const customQR = await shl.asQR({
   *   width: 512,
   *   errorCorrectionLevel: 'H',
   *   color: { dark: '#000000', light: '#FFFFFF' }
   * });
   * ```
   */
  async asQR(params?: SHLQREncodeParams): Promise<string> {
    let shlinkURI = this.toURI()
    if (params?.viewerURL) {
      shlinkURI = `${params.viewerURL}#${shlinkURI}`
    }

    const qrOptions: QRCode.QRCodeToDataURLOptions = {
      width: params?.width ?? 256,
      margin: params?.margin ?? 1,
      errorCorrectionLevel: params?.errorCorrectionLevel ?? 'M',
      color: params?.color ?? { dark: '#000000', light: '#FFFFFF' },
      type: 'image/png',
    }

    return QRCode.toDataURL(shlinkURI, qrOptions)
  }

  /**
   * Static factory method to create an SHL from a parsed payload.
   *
   * This method is used internally by {@link SHLViewer} to reconstruct SHL objects
   * from parsed SHLink URIs. It does not generate new keys or paths, but uses
   * the provided values from an existing payload.
   *
   * @param payload - Validated SHLink payload from a parsed URI
   * @returns SHL instance reconstructed from the payload
   *
   * @internal
   */
  static fromPayload(payload: SHLinkPayloadV1): SHL {
    const args: {
      manifestURL: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      manifestURL: payload.url,
      key: payload.key,
    }
    if (payload.exp !== undefined) args.expirationDate = new Date(payload.exp * 1000)
    if (payload.flag !== undefined) args.flag = payload.flag
    if (payload.label !== undefined) args.label = payload.label
    return new SHL(args)
  }

  /**
   * Static method to validate a SHLink payload structure.
   *
   * Validates that the payload conforms to the Smart Health Links v1 specification,
   * including required fields (url, key), optional fields (exp, flag, label, v),
   * and format constraints (key length, label length, URL validity, flag characters).
   *
   * @param payload - Unknown payload object to validate
   * @throws {@link SHLFormatError} When payload structure is invalid
   *
   * @internal
   */
  static validatePayload(payload: unknown): asserts payload is SHLinkPayloadV1 {
    if (!payload || typeof payload !== 'object') {
      throw new SHLFormatError('Invalid SHLink payload: must be an object')
    }

    const p = payload as Record<string, unknown>

    // Required fields
    if (!p.url || typeof p.url !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: missing or invalid "url" field')
    }

    if (!p.key || typeof p.key !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: missing or invalid "key" field')
    }

    // Validate key length (should be 43 characters for base64url-encoded 32 bytes)
    if (p.key.length !== 43) {
      throw new SHLFormatError('Invalid SHLink payload: "key" field must be 43 characters')
    }

    // Optional fields validation
    if (p.exp !== undefined && (typeof p.exp !== 'number' || p.exp <= 0)) {
      throw new SHLFormatError('Invalid SHLink payload: "exp" field must be a positive number')
    }

    if (p.flag !== undefined && typeof p.flag !== 'string') {
      throw new SHLFormatError('Invalid SHLink payload: "flag" field must be a string')
    }

    if (p.label !== undefined && (typeof p.label !== 'string' || p.label.length > 80)) {
      throw new SHLFormatError(
        'Invalid SHLink payload: "label" field must be a string of 80 characters or less'
      )
    }

    if (p.v !== undefined && p.v !== 1) {
      throw new SHLFormatError('Invalid SHLink payload: unsupported version')
    }

    // Validate URL format
    try {
      new URL(p.url)
    } catch {
      throw new SHLFormatError('Invalid SHLink payload: "url" field is not a valid URL')
    }

    // Validate flag format if present
    if (p.flag && !['L', 'P', 'LP', 'U', 'LU'].includes(p.flag)) {
      throw new SHLFormatError(
        'Invalid SHLink payload: "flag" not one of "L", "P", "LP", "U", "LU"'
      )
    }
  }

  /**
   * Static method to parse a SHLink URI into an SHL object.
   *
   * Handles both bare SHLink URIs and viewer-prefixed URIs:
   * - `shlink:/eyJ1cmwiOi4uLn0` (bare)
   * - `https://viewer.example/#shlink:/eyJ1cmwiOi4uLn0` (viewer-prefixed)
   *
   * Validates URI format, decodes base64url payload, parses JSON,
   * and validates payload structure according to SHL specification.
   *
   * @param shlinkURI - SHLink URI to parse
   * @returns SHL instance with parsed payload data
   * @throws {@link SHLFormatError} When URI format is invalid, payload cannot be decoded, or payload structure is invalid
   */
  static parse(shlinkURI: string): SHL {
    try {
      // Remove viewer prefix if present (ends with #)
      let uriToParse = shlinkURI
      const hashIndex = shlinkURI.indexOf('#shlink:/')
      if (hashIndex !== -1) {
        uriToParse = shlinkURI.substring(hashIndex + 1)
      }

      // Validate shlink:/ prefix
      if (!uriToParse.startsWith('shlink:/')) {
        throw new SHLFormatError('Invalid SHLink URI: must start with "shlink:/"')
      }

      // Extract and decode the payload
      const payloadB64u = uriToParse.substring('shlink:/'.length)
      if (!payloadB64u) {
        throw new SHLFormatError('Invalid SHLink URI: missing payload')
      }

      // Decode base64url payload
      let payloadBytes: Uint8Array
      try {
        payloadBytes = base64url.decode(payloadB64u)
      } catch {
        throw new SHLFormatError('Invalid SHLink URI: payload is not valid base64url')
      }

      // Parse JSON payload
      const payloadJson = new TextDecoder().decode(payloadBytes)
      let payload: SHLinkPayloadV1
      try {
        payload = JSON.parse(payloadJson) as SHLinkPayloadV1
      } catch {
        throw new SHLFormatError('Invalid SHLink URI: payload is not valid JSON')
      }

      // Validate payload structure
      SHL.validatePayload(payload)

      // Create a reconstructed SHL object using the static factory method
      return SHL.fromPayload(payload)
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLFormatError(`Failed to parse SHLink URI: ${errorMessage}`)
    }
  }
}
