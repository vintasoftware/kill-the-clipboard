// Types for Smart Health Links
import type { Resource } from '@medplum/fhirtypes'

/**
 * FHIR R4 Resource type re-exported from @medplum/fhirtypes for convenience.
 *
 * @public
 * @category SHL Types
 */
export type FHIRResource = Resource

/**
 * SHL flags supported by this implementation.
 *
 * @public
 * @category SHL Types
 */
export type SHLFlag = 'L' | 'P' | 'LP'

/**
 * Content types supported for SHL files.
 *
 * @public
 * @category SHL Types
 */
export type SHLFileContentType = 'application/smart-health-card' | 'application/fhir+json'

/**
 * SHLink Payload structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLinkPayloadV1 {
  /** Manifest URL for this SHLink */
  url: string
  /** Symmetric key (43 characters, base64url-encoded) */
  key: string
  /** Optional expiration time in Epoch seconds */
  exp?: number
  /** Optional flag string (concatenated single-character flags) */
  flag?: SHLFlag
  /** Optional short description (max 80 characters) */
  label?: string
  /** Optional version (defaults to 1) */
  v?: 1
}

/**
 * Manifest request structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestRequestV1 {
  /** Required recipient display string */
  recipient: string
  /** Conditional when 'P' flag is present */
  passcode?: string
  /** Optional upper bound for embedded payload sizes */
  embeddedLengthMax?: number
}

/**
 * Manifest file descriptor for embedded content.
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1EmbeddedDescriptor {
  contentType: SHLFileContentType
  /** JWE Compact serialized encrypted file */
  embedded: string
}

/**
 * Manifest file descriptor for external content.
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1LocationDescriptor {
  contentType: SHLFileContentType
  /** HTTPS URL to encrypted JWE file */
  location: string
}

/**
 * Union type for manifest file descriptors.
 *
 * @public
 * @category SHL Types
 */
export type SHLManifestFileDescriptor =
  | SHLManifestV1EmbeddedDescriptor
  | SHLManifestV1LocationDescriptor

/**
 * SHL Manifest structure (v1).
 *
 * @public
 * @category SHL Types
 */
export interface SHLManifestV1 {
  files: SHLManifestFileDescriptor[]
}

/**
 * Internal structure for encrypted files.
 *
 * @public
 * @category SHL Types
 */
export interface SHLFileJWE {
  type: SHLFileContentType
  jwe: string
}

/**
 * Serialized file metadata persisted in DB (NOT the JWE content).
 * Used to reconstruct manifest responses with fresh short-lived URLs.
 *
 * @public
 * @category SHL Types
 */
export interface SerializedSHLManifestBuilderFile {
  /** Content type. */
  type: SHLFileContentType
  /** Storage path or object key where ciphertext is persisted (for signing on demand). */
  storagePath: string
  /** Total JWE compact length, used to decide embedding vs. location quickly. */
  ciphertextLength: number
}

/**
 * Serialized builder state persisted in DB (NOT the manifest response).
 * Contains the SHL payload and file metadata for reconstructing fresh manifests.
 *
 * @public
 * @category SHL Types
 */
export interface SerializedSHLManifestBuilder {
  shl: SHLinkPayloadV1
  files: SerializedSHLManifestBuilderFile[]
}

/**
 * Resolved SHL content containing the manifest and all decrypted files.
 *
 * @public
 * @category SHL Types
 */
export interface SHLResolvedContent {
  /** The fetched manifest */
  manifest: SHLManifestV1
  /** Smart Health Cards extracted from application/smart-health-card files */
  smartHealthCards: unknown[] // Will be SmartHealthCard[] but avoiding circular import
  /** FHIR resources extracted from application/fhir+json files */
  fhirResources: Resource[]
}
