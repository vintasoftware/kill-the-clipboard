// Types and processors for SMART Health Cards
import type { Bundle } from '@medplum/fhirtypes'
import type { Directory } from './directory'

/**
 * FHIR R4 Bundle type re-exported from @medplum/fhirtypes for convenience.
 *
 * @public
 * @group SHC
 * @category Types
 */
export type FHIRBundle = Bundle

/**
 * Verifiable Credential structure for SMART Health Cards.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface VerifiableCredential {
  /** The verifiable credential content. */
  vc: {
    /** Array of credential types, must include 'https://smarthealth.cards#health-card'. */
    type: string[]
    /** The credential subject containing FHIR data. */
    credentialSubject: {
      /** FHIR version in semantic version format (e.g., '4.0.1'). */
      fhirVersion: string
      /** The FHIR Bundle containing medical data. */
      fhirBundle: FHIRBundle
    }
    rid?: string
  }
}

/**
 * JWT payload structure for SMART Health Cards.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface SHCJWT {
  /** Issuer URL identifying the organization. */
  iss: string
  /** Not before timestamp (Unix timestamp). */
  nbf: number
  /** Optional expiration timestamp (Unix timestamp). */
  exp?: number
  /** The verifiable credential content. */
  vc: VerifiableCredential['vc']
}

/**
 * Configuration parameters for SHCIssuer.
 *
 * @public
 * @group SHC
 * @category Configuration
 */
export interface SHCConfigParams {
  /**
   * Issuer URL identifying the organization issuing the health card.
   * This value appears in the JWT `iss` claim.
   */
  issuer: string

  /**
   * ES256 private key for signing health cards.
   * Can be a WebCrypto CryptoKey, raw bytes as Uint8Array, PEM-formatted string, or JsonWebKey object.
   */
  privateKey: CryptoKey | Uint8Array | string | JsonWebKey

  /**
   * ES256 public key corresponding to the private key.
   * Used for key ID (`kid`) derivation per SMART Health Cards specification.
   */
  publicKey: CryptoKey | Uint8Array | string | JsonWebKey

  /**
   * Optional expiration time in seconds from now.
   * If `null`, health cards will not have an expiration (`exp` claim).
   * @defaultValue `null`
   */
  expirationTime?: number | null

  /**
   * Whether to optimize FHIR Bundle for QR codes by using short resource-scheme URIs
   * (`resource:0`, `resource:1`, etc.) and removing unnecessary fields.
   * @defaultValue `true`
   */
  enableQROptimization?: boolean

  /**
   * Whether to enforce strict reference validation during QR optimization.
   * If `true`, throws error for missing bundle references.
   * If `false`, preserves original references when target resource is not found.
   * @defaultValue `true`
   */
  strictReferences?: boolean
}

/**
 * @group SHC
 * @category Configuration
 */
export type SHCConfig = Required<SHCConfigParams>

/**
 * Configuration parameters for SHCReader.
 * Reader configuration only needs public key for verification.
 *
 * @public
 * @group SHC
 * @category Configuration
 */
export interface SHCReaderConfigParams {
  /**
   * ES256 public key for verifying health card signatures.
   * Can be a WebCrypto CryptoKey, raw bytes as Uint8Array, PEM-formatted string, or JsonWebKey object.
   */
  publicKey?: CryptoKey | Uint8Array | string | JsonWebKey | null

  /**
   * Whether to optimize FHIR Bundle for QR codes when reading health cards.
   * Should match the issuer's setting for proper reconstruction.
   * @defaultValue `true`
   */
  enableQROptimization?: boolean

  /**
   * Whether to enforce strict reference validation during optimization.
   * Should match the issuer's setting for proper reconstruction.
   * @defaultValue `true`
   */
  strictReferences?: boolean

  /**
   * Whether to verify the JWT `exp` claim during verification.
   * When true (default), expired health cards will be rejected.
   * Set to false to allow expired cards to be accepted.
   * @defaultValue `true`
   */
  verifyExpiration?: boolean

  /**
   * Optional pre-fetched `Directory` instance containing issuer metadata
   * (JWKS keys and optional CRLs). Pass `null` to explicitly indicate
   * no directory is available.
   * @defaultValue `null`
   */
  issuerDirectory?: Directory | null

  /**
   * Whether to consult the VCI directory to resolve issuer metadata (JWKS and related information).
   * When `true`, the reader will attempt to resolve keys from the VCI directory during verification.
   * When `false`, no automatic VCI directory lookup will be performed.
   * @defaultValue `false`
   */
  useVciDirectory?: boolean
}

/**
 * @group SHC
 * @category Configuration
 */
export type SHCReaderConfig = {
  /**
   * ES256 public key for verifying health card signatures.
   * Can be a WebCrypto CryptoKey, raw bytes as Uint8Array, PEM-formatted string, or JsonWebKey object.
   * If `null`, the reader will attempt to resolve the public key from the issuer's JWKS endpoint.
   */
  publicKey?: CryptoKey | Uint8Array | string | JsonWebKey | null
} & Required<Omit<SHCReaderConfigParams, 'publicKey'>>

/**
 * Parameters for creating Verifiable Credentials.
 *
 * @public
 * @group SHC
 * @category Configuration
 */
export interface VerifiableCredentialParams {
  /**
   * FHIR version string in semantic version format (e.g., '4.0.1').
   * @defaultValue `'4.0.1'`
   */
  fhirVersion?: string

  /**
   * Array of additional Verifiable Credential type URIs to include beyond
   * the standard `https://smarthealth.cards#health-card`.
   *
   * Common values:
   * - `https://smarthealth.cards#immunization`
   * - `https://smarthealth.cards#covid19`
   * - `https://smarthealth.cards#laboratory`
   */
  includeAdditionalTypes?: string[]
}

/**
 * Additional QR encoding parameters that can be passed to the qrcode library.
 * This interface matches the expected qrcode library params.
 *
 * @public
 * @group SHC
 * @category Configuration
 */
export interface QREncodeParams {
  /**
   * Error correction level per SMART Health Cards specification:
   * - **L (Low)**: ~7% error resistance, 1195 max characters (V22)
   * - **M (Medium)**: ~15% error resistance, 927 max characters (V22)
   * - **Q (Quartile)**: ~25% error resistance, 670 max characters (V22)
   * - **H (High)**: ~30% error resistance, 519 max characters (V22)
   * @defaultValue `'L'`
   */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'

  /**
   * QR code version determining symbol size.
   * Version 1 is 21x21 modules, Version 2 is 25x25, etc.
   * Auto-selected by default based on data size.
   * @remarks Range: 1-40
   */
  version?: number

  /**
   * Mask pattern used to mask the QR code symbol.
   * Auto-selected by default for optimal readability.
   * @remarks Range: 0-7
   */
  maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

  /**
   * Quiet zone size (border) around the QR code in modules.
   * @defaultValue `1`
   */
  margin?: number

  /**
   * Scale factor for output image. A value of 1 means 1 pixel per module.
   * @defaultValue `4`
   */
  scale?: number

  /**
   * Forces specific width for output image in pixels.
   * Takes precedence over `scale` if specified.
   */
  width?: number

  /** Color configuration for QR code modules. */
  color?: {
    /**
     * Color of dark modules in hex RGBA format (e.g., '#000000ff' for black).
     * @defaultValue `'#000000ff'`
     */
    dark?: string

    /**
     * Color of light modules in hex RGBA format (e.g., '#ffffffff' for white).
     * @defaultValue `'#ffffffff'`
     */
    light?: string
  }
}

/**
 * Configuration parameters for QR code generation.
 *
 * @public
 * @group SHC
 * @category Configuration
 */
export interface QRCodeConfigParams {
  /**
   * Maximum JWS character length for single QR code.
   * Auto-derived from `errorCorrectionLevel` if not provided:
   * - L: 1195 characters
   * - M: 927 characters
   * - Q: 670 characters
   * - H: 519 characters
   *
   * Based on Version 22 QR code limits from
   * {@link https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md | SMART Health Cards QR FAQ}.
   */
  maxSingleQRSize?: number

  /**
   * Whether to support multi-chunk QR codes.
   * Note that chunked QR codes are deprecated per SMART Health Cards specification,
   * but supported for compatibility.
   * @defaultValue `false`
   */
  enableChunking?: boolean

  /** Options passed to the underlying QR code encoder. */
  encodeOptions?: QREncodeParams
}

/**
 * @group SHC
 * @category Configuration
 */
export type QRCodeConfig = Required<QRCodeConfigParams>

/**
 * Minimal JWK descriptor used in the public Directory representation.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface IssuerKey {
  /** Key type (e.g. 'EC' or 'RSA'). */
  kty: string
  /** Key ID used to identify the key in JWKS responses. */
  kid: string
}

/**
 * Representation of a Certificate Revocation List (CRL) entry used by the
 * directory to mark revoked resource IDs for a given key.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface IssuerCrl {
  /** The `kid` of the key this CRL pertains to. */
  kid: string
  /** Revocation method identifier (e.g. 'rid'). */
  method: string
  /** Monotonic counter for CRL updates. */
  ctr: number
  /** List of revoked resource ids (rids). */
  rids: string[]
}

/**
 * Public issuer metadata aggregated by the Directory.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface Issuer {
  /** Issuer base URL (the `iss` claim value). */
  iss: string
  /** Array of known JWK descriptors for the issuer. */
  keys: IssuerKey[]
  /** Optional array of CRL entries for revoked resource ids. */
  crls?: IssuerCrl[]
}

/**
 * JSON shape for a published directory file containing issuer metadata.
 *
 * @public
 * @group SHC
 * @category Types
 */
export interface DirectoryJSON {
  issuerInfo: {
    issuer: {
      /** Issuer base URL */
      iss: string
    }
    /** Array of JWK descriptors returned from the issuer's JWKS endpoint. */
    keys: IssuerKey[]
    /** Optional CRL entries published alongside the directory. */
    crls?: IssuerCrl[]
  }[]
}
