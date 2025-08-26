import { base64url } from 'jose'
import { SHLFormatError } from './errors.js'
import type { SHLFlag, SHLinkPayloadV1 } from './types.js'

/**
 * Immutable SHL class representing a Smart Health Link payload and URI.
 * This class only handles the SHLink "pointer" - the payload containing url, key, flags, etc.
 * Use SHLManifestBuilder to manage the manifest and files referenced by this SHL.
 *
 * @public
 * @category SHL High-Level API
 */
export class SHL {
  private readonly _baseURL: string
  private readonly _manifestPath: string
  private readonly _key: string
  private readonly _expirationDate: Date | undefined
  private readonly _flag: SHLFlag | undefined
  private readonly _label: string | undefined
  private readonly v: 1 = 1

  /**
   * Private constructor for internal instantiation. Use SHL.generate to create new instances.
   */
  private constructor(core: {
    baseURL: string
    manifestPath: string
    key: string
    expirationDate?: Date
    flag?: SHLFlag
    label?: string
  }) {
    this._baseURL = core.baseURL
    this._manifestPath = core.manifestPath
    this._key = core.key
    this._expirationDate = core.expirationDate
    this._flag = core.flag
    this._label = core.label
  }

  /**
   * Create an immutable SHL representing a Smart Health Link payload and URI.
   * Generates manifest path and encryption symmetric key automatically.
   *
   * @param params.baseURL - Base URL for constructing manifest URLs (e.g., 'https://shl.example.org/manifests/')
   * @param params.expirationDate - Optional expiration date for the SHLink, will fill the `exp` field in the SHLink payload.
   * @param params.flag - Optional flag for the SHLink: `L` (long-term), `P` (passcode), `LP` (long-term + passcode).
   * @param params.label - Optional label that provides a short description of the data behind the SHLink. Max length of 80 chars.
   */
  static generate(params: {
    baseURL: string
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

    // Generate 32 random bytes for manifest path (43 chars base64url-encoded)
    const pathEntropy = new Uint8Array(32)
    crypto.getRandomValues(pathEntropy)
    const manifestPath = `/manifests/${base64url.encode(pathEntropy)}/manifest.json`

    // Generate 32 random bytes for encryption key (43 chars base64url-encoded)
    const keyEntropy = new Uint8Array(32)
    crypto.getRandomValues(keyEntropy)
    const key = base64url.encode(keyEntropy)

    const args: {
      baseURL: string
      manifestPath: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      baseURL: params.baseURL,
      manifestPath,
      key,
    }
    if (expirationDate !== undefined) args.expirationDate = expirationDate
    if (flag !== undefined) args.flag = flag
    if (label !== undefined) args.label = label
    return new SHL(args)
  }

  /** Generate the SHLink URI respecting the "Construct a SHLink Payload" section of the spec. */
  generateSHLinkURI(): string {
    const payload = this.payload
    const payloadJson = JSON.stringify(payload)
    const payloadB64u = base64url.encode(new TextEncoder().encode(payloadJson))
    return `shlink:/${payloadB64u}`
  }

  /** Get the full manifest URL that servers must handle (POST requests as per spec). */
  get url(): string {
    return this._baseURL.replace(/\/$/, '') + this._manifestPath
  }

  /** Get the base URL used for constructing manifest URLs. */
  get baseURL(): string {
    return this._baseURL
  }

  /** Get the manifest path. */
  get manifestPath(): string {
    return this._manifestPath
  }

  /** Get the base64url-encoded encryption key for files (43 characters). */
  get key(): string {
    return this._key
  }

  /** Get the expiration date as Epoch seconds if set. */
  get exp(): number | undefined {
    return this._expirationDate ? Math.floor(this._expirationDate.getTime() / 1000) : undefined
  }

  /** Get the expiration date if set. */
  get expirationDate(): Date | undefined {
    return this._expirationDate
  }

  /** Get the SHL flags if set. */
  get flag(): SHLFlag | undefined {
    return this._flag
  }

  /** Get the label if set. */
  get label(): string | undefined {
    return this._label
  }

  /** Get the version (always 1 for v1). */
  get version(): 1 {
    return this.v
  }

  /** Check if this SHL requires a passcode (has 'P' flag). */
  get requiresPasscode(): boolean {
    return this._flag?.includes('P') ?? false
  }

  /** Check if this SHL is long-term (has 'L' flag). */
  get isLongTerm(): boolean {
    return this._flag?.includes('L') ?? false
  }

  /** Get the SHL payload object for serialization. */
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
   * Static factory method to create an SHL from a parsed payload (for viewing purposes only).
   * This is used internally by SHLViewer to reconstruct SHL objects from URIs.
   */
  static fromPayload(payload: SHLinkPayloadV1, baseURL: string, manifestPath: string): SHL {
    const args: {
      baseURL: string
      manifestPath: string
      key: string
      expirationDate?: Date
      flag?: SHLFlag
      label?: string
    } = {
      baseURL,
      manifestPath,
      key: payload.key,
    }
    if (payload.exp !== undefined) args.expirationDate = new Date(payload.exp * 1000)
    if (payload.flag !== undefined) args.flag = payload.flag
    if (payload.label !== undefined) args.label = payload.label
    return new SHL(args)
  }

  /**
   * Static method to validate a SHLink payload structure.
   * This is used internally by SHLViewer during URI parsing.
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
    if (p.flag && !/^[LP]+$/.test(p.flag)) {
      throw new SHLFormatError('Invalid SHLink payload: "flag" field contains invalid characters')
    }
  }
}
