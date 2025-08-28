// Types for Smart Health Links
import type { Resource } from '@medplum/fhirtypes'
import type { SmartHealthCard } from '../shc/card.js'

/**
 * FHIR R4 Resource type re-exported from @medplum/fhirtypes for convenience.
 *
 * Represents any valid FHIR R4 resource that can be shared via Smart Health Links.
 * This includes Patient, Bundle, Observation, Condition, and all other FHIR resource types.
 *
 * @public
 * @category Types
 */
export type FHIRResource = Resource

/**
 * SHL flags supported by this implementation.
 *
 * Flags modify the behavior of Smart Health Links:
 * - `'L'`: Long-term - Recipients may poll the manifest URL for updates over time
 * - `'P'`: Passcode-protected - A passcode is required to access the manifest
 * - `'LP'`: Both long-term and passcode-protected
 *
 * Flags are concatenated in the SHL payload (e.g., 'LP' means both L and P flags are set).
 *
 * @public
 * @category Types
 */
export type SHLFlag = 'L' | 'P' | 'LP'

/**
 * Content types supported for SHL files.
 *
 * These MIME types identify the format of encrypted files in SHL manifests:
 * - `'application/smart-health-card'`: SMART Health Card files containing JWS tokens
 * - `'application/fhir+json'`: FHIR R4 resources in JSON format
 *
 * The content type is stored in the JWE protected header (cty field) and
 * used by viewers to properly parse decrypted content.
 *
 * @public
 * @category Types
 */
export type SHLFileContentType = 'application/smart-health-card' | 'application/fhir+json'

/**
 * SHLink Payload structure (v1).
 *
 * This is the core data structure that gets base64url-encoded in SHLink URIs.
 * Contains all information needed to access and decrypt SHL content.
 *
 * The payload is serialized as minified JSON and encoded as base64url in the
 * SHLink URI: `shlink:/<base64url-encoded-payload>`
 *
 * @example
 * ```typescript
 * const payload: SHLinkPayloadV1 = {
 *   url: 'https://shl.example.org/manifests/abc123.../manifest.json',
 *   key: 'GawgguITVNvYokrepxQx_A663dZs3Q8a5_H2lBpxdUo', // 43 chars
 *   exp: 1640995200, // Unix timestamp
 *   flag: 'LP', // Long-term + passcode
 *   label: 'Lab Results - Dec 2021',
 *   v: 1
 * };
 * ```
 *
 * @public
 * @category Types
 */
export interface SHLinkPayloadV1 {
  /**
   * Manifest URL for this SHLink.
   * HTTPS URL where the manifest can be fetched via POST request.
   */
  url: string
  /**
   * Symmetric encryption key (43 characters, base64url-encoded).
   * 256-bit key used for JWE file encryption/decryption.
   */
  key: string
  /**
   * Optional expiration time in Unix seconds.
   * When present, SHL expires at this timestamp and should not be resolved.
   */
  exp?: number
  /**
   * Optional flag string (concatenated single-character flags).
   * Modifies SHL behavior: 'L' (long-term), 'P' (passcode), 'LP' (both).
   */
  flag?: SHLFlag
  /**
   * Optional short description (max 80 characters).
   * Human-readable label describing the shared content.
   */
  label?: string
  /**
   * Optional version (defaults to 1).
   * SHL specification version, currently always 1.
   */
  v?: 1
}

/**
 * Manifest request structure (v1).
 *
 * This is the JSON body sent in POST requests to SHL manifest URLs.
 * The recipient field identifies the requesting party, while optional
 * fields provide passcode authentication and embedding preferences.
 *
 * @example
 * ```typescript
 * const manifestRequest: SHLManifestRequestV1 = {
 *   recipient: 'Dr. Smith - General Practice',
 *   passcode: 'user-entered-passcode', // if P flag is set
 *   embeddedLengthMax: 8192 // prefer files under 8KB embedded
 * };
 *
 * const response = await fetch(shl.url, {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify(manifestRequest)
 * });
 * ```
 *
 * @public
 * @category Types
 */
export interface SHLManifestRequestV1 {
  /**
   * Required recipient display string.
   * Identifies the requesting user/system (e.g., "Dr. Smith", "Patient Portal").
   * Used for logging and audit purposes.
   */
  recipient: string
  /**
   * Optional passcode for P-flagged SHLinks.
   * Required when SHL has 'P' flag. Server validates against stored hash.
   */
  passcode?: string
  /**
   * Optional upper bound for embedded payload sizes in bytes.
   * Files smaller than this will be embedded in manifest, larger ones use location URLs.
   * Typical values: 4096-32768. Server may ignore or cap this value.
   */
  embeddedLengthMax?: number
}

/**
 * Manifest file descriptor for embedded content.
 *
 * Used when file content is small enough to be included directly in the
 * manifest response. The embedded field contains the complete JWE string
 * that can be decrypted immediately without additional network requests.
 *
 * @public
 * @category Types
 */
export interface SHLManifestV1EmbeddedDescriptor {
  /**
   * Content type of the encrypted file.
   * Indicates how to parse the content after decryption.
   */
  contentType: SHLFileContentType
  /**
   * JWE Compact serialized encrypted file.
   * Complete JWE string that can be decrypted using the SHL key.
   */
  embedded: string
}

/**
 * Manifest file descriptor for external content.
 *
 * Used when file content is too large for embedding or when the server
 * prefers location-based access. The location URL is typically short-lived
 * and intended for single use to maintain security.
 *
 * @public
 * @category Types
 */
export interface SHLManifestV1LocationDescriptor {
  /**
   * Content type of the encrypted file.
   * Indicates how to parse the content after decryption.
   */
  contentType: SHLFileContentType
  /**
   * HTTPS URL to encrypted JWE file.
   * Short-lived URL for downloading the encrypted content.
   */
  location: string
}

/**
 * Union type for manifest file descriptors.
 *
 * A manifest file descriptor is either embedded (content included directly)
 * or location-based (content referenced by URL). Discriminated by the presence
 * of 'embedded' vs 'location' fields.
 *
 * @public
 * @category Types
 */
export type SHLManifestFileDescriptor =
  | SHLManifestV1EmbeddedDescriptor
  | SHLManifestV1LocationDescriptor

/**
 * SHL Manifest structure (v1).
 *
 * The manifest is the JSON response returned by SHL manifest URLs.
 * It contains an array of file descriptors that reference the encrypted
 * files associated with the SHL. Each file can be either embedded directly
 * or referenced by a location URL.
 *
 * @example
 * ```typescript
 * const manifest: SHLManifestV1 = {
 *   files: [
 *     {
 *       contentType: 'application/smart-health-card',
 *       embedded: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIi4uLg==' // Small file
 *     },
 *     {
 *       contentType: 'application/fhir+json',
 *       location: 'https://files.example.org/temp/abc123?expires=...' // Large file
 *     }
 *   ]
 * };
 * ```
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
 * Used internally by the SHL implementation to represent encrypted file
 * content along with its metadata. Contains the JWE string and content type
 * information needed for manifest building.
 *
 * @public
 * @category SHL Types
 */
export interface SHLFileJWE {
  type: SHLFileContentType
  jwe: string
}

/**
 * Serialized file metadata persisted in database.
 *
 * Contains metadata about encrypted files without the actual JWE content.
 * Used to reconstruct manifest responses with fresh short-lived URLs.
 * The actual encrypted content is stored separately and retrieved using
 * the storage path when needed.
 *
 * This separation allows efficient manifest generation without loading
 * all file content, and enables URL rotation for security.
 *
 * @public
 * @category SHL Types
 */
export interface SerializedSHLManifestBuilderFile {
  /**
   * Content type of the encrypted file.
   * Used to generate appropriate file descriptors in manifests.
   */
  type: SHLFileContentType
  /**
   * Storage path or object key where ciphertext is persisted.
   * Used with getFileURL() to generate location URLs and loadFile() to retrieve content.
   */
  storagePath: string
  /**
   * Total JWE compact length in bytes.
   * Used to decide between embedding vs. location-based serving without loading content.
   */
  ciphertextLength: number
}

/**
 * Serialized builder state persisted in database.
 *
 * This is the complete state needed to reconstruct an SHLManifestBuilder.
 * Contains the SHL payload and file metadata, but NOT the manifest response
 * itself. Manifests are generated fresh on each request with up-to-date URLs.
 *
 * Servers should store this structure in their database and use it to
 * recreate builders when handling manifest requests.
 *
 * @example
 * ```typescript
 * // Save builder state
 * const builderState = builder.serialize();
 * await database.saveSHL(shlId, builderState);
 *
 * // Load and reconstruct later
 * const savedState = await database.loadSHL(shlId);
 * const builder = SHLManifestBuilder.deserialize({
 *   data: savedState,
 *   uploadFile: myUploadFn,
 *   getFileURL: myGetURLFn
 * });
 * ```
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
 * This is the final result of SHL resolution, containing both the raw manifest
 * and the parsed, decrypted content organized by type. Applications can use
 * this structured data without needing to handle JWE decryption or content
 * type parsing themselves.
 *
 * The Smart Health Cards are fully parsed and ready for verification/display,
 * while FHIR resources are parsed JSON objects ready for processing.
 *
 * @example
 * ```typescript
 * const resolved = await viewer.resolveSHLink({ recipient: 'Dr. Smith' });
 *
 * // Process Smart Health Cards
 * for (const shc of resolved.smartHealthCards) {
 *   console.log('Issuer:', shc.issuer);
 *   console.log('Patient:', shc.fhirBundle.entry[0].resource);
 * }
 *
 * // Process FHIR resources
 * for (const resource of resolved.fhirResources) {
 *   if (resource.resourceType === 'Bundle') {
 *     console.log('Bundle with', resource.entry?.length, 'entries');
 *   }
 * }
 * ```
 *
 * @public
 * @category SHL Types
 */
export interface SHLResolvedContent {
  /**
   * The fetched manifest response.
   * Contains the raw manifest structure with file descriptors.
   */
  manifest: SHLManifestV1
  /**
   * Smart Health Cards extracted from application/smart-health-card files.
   * Each card is fully parsed and ready for verification or display.
   */
  smartHealthCards: SmartHealthCard[]
  /**
   * FHIR resources extracted from application/fhir+json files.
   * Each resource is a parsed JSON object conforming to FHIR R4 specification.
   */
  fhirResources: Resource[]
}
