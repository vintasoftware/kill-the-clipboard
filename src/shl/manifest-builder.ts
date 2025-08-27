import type { Resource } from '@medplum/fhirtypes'
import { encryptSHLFile } from './crypto.js'
import { SHLError, SHLManifestError, SHLManifestRateLimitError, SHLNetworkError } from './errors.js'
import { SHL } from './shl.js'
import type {
  SerializedSHLManifestBuilder,
  SerializedSHLManifestBuilderFile,
  SHLFileContentType,
  SHLFileJWE,
  SHLManifestFileDescriptor,
  SHLManifestV1,
} from './types.js'

// Import SmartHealthCard type - using unknown to avoid circular imports
type SmartHealthCard = unknown & { asJWS(): string }

/**
 * Class that builds the manifest and files for a Smart Health Link.
 *
 * This class handles file encryption, upload, and manifest building for SHL content.
 * It encrypts files using JWE with A256GCM, manages file storage through provided
 * upload/retrieval functions, and generates manifests with embedded or location-based
 * file descriptors based on size thresholds.
 *
 * Per the SHL specification, servers SHALL persist the builder state (not the manifest)
 * and generate fresh manifests with short-lived URLs on each request. This ensures
 * URLs remain secure and can be rotated frequently.
 *
 * The builder supports:
 * - Smart Health Card files (JWS format)
 * - FHIR JSON resources
 * - Optional compression with raw DEFLATE
 * - Embedded vs location-based file serving
 * - Serialization/deserialization for persistence
 *
 * @example
 * ```typescript
 * // Create SHL and builder
 * const shl = SHL.generate({
 *   baseManifestURL: 'https://shl.example.org/manifests/',
 *   manifestPath: '/manifest.json',
 *   flag: 'P'
 * });
 * const builder = new SHLManifestBuilder({
 *   shl,
 *   uploadFile: async (content) => {
 *     // Upload encrypted content to storage, return path
 *     return await myStorage.upload(content);
 *   },
 *   getFileURL: (path) => {
 *     // Generate short-lived signed URL for path
 *     return myStorage.getSignedURL(path);
 *   }
 * });
 *
 * // Add files
 * await builder.addHealthCard({ shc: mySmartHealthCard });
 * await builder.addFHIRResource({ content: myFhirBundle });
 *
 * // Generate manifest
 * const manifest = await builder.buildManifest({ embeddedLengthMax: 16384 });
 * ```
 *
 * @public
 * @category High-Level API
 */
export class SHLManifestBuilder {
  private readonly _shl: SHL
  private readonly uploadFile: (
    content: string,
    contentType?: SHLFileContentType
  ) => Promise<string>
  private readonly getFileURL: (path: string) => string
  private readonly loadFile: (path: string) => Promise<string>
  private readonly _files: SerializedSHLManifestBuilderFile[] = []

  /**
   * Create a manifest builder for the given SHL.
   *
   * The builder requires functions for file storage operations. These functions
   * abstract the storage backend (S3, filesystem, database, etc.) and allow
   * the builder to work with any storage system.
   *
   * @param params.shl - The immutable SHL instance this builder manages.
   *   Contains the encryption key and manifest URL for this SHL.
   * @param params.uploadFile - Function to upload encrypted files to storage.
   *   Receives the JWE content as a string and optional content type.
   *   Must return a storage path/key that can be used with `getFileURL` and `loadFile`.
   *   Called once per file when added to the builder.
   * @param params.getFileURL - Function to generate URLs for stored files.
   *   Receives a storage path from `uploadFile` and returns an HTTPS URL.
   *   Per SHL spec, URLs SHALL be short-lived and intended for single use.
   *   Called each time a manifest is built for location-based files.
   * @param params.loadFile - Optional function to load file content from storage.
   *   Receives a storage path and returns the JWE content as a string.
   *   If not provided, defaults to fetching via `getFileURL()` with the provided fetch implementation.
   *   Called when building manifests for embedded files.
   * @param params.fetch - Optional fetch implementation for the default loadFile.
   *   Only used if `loadFile` is not provided. Defaults to global fetch.
   *
   * @example
   * ```typescript
   * // With S3-like storage
   * const builder = new SHLManifestBuilder({
   *   shl: myShl,
   *   uploadFile: async (content, contentType) => {
   *     const key = `shl-files/${crypto.randomUUID()}.jwe`;
   *     await s3.putObject({ Key: key, Body: content, ContentType: 'application/jose' });
   *     return key;
   *   },
   *   getFileURL: (path) => {
   *     return s3.getSignedUrl('getObject', { Key: path, Expires: 3600 });
   *   },
   *   loadFile: async (path) => {
   *     const result = await s3.getObject({ Key: path });
   *     return result.Body.toString();
   *   }
   * });
   * ```
   */
  constructor(params: {
    shl: SHL
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => string
    loadFile?: (path: string) => Promise<string>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }) {
    this._shl = params.shl
    this.uploadFile = params.uploadFile
    this.getFileURL = params.getFileURL

    // Use provided loadFile or create default implementation
    this.loadFile = params.loadFile ?? this.createDefaultLoadFile(params.fetch ?? fetch)
  }

  /**
   * Creates a default loadFile implementation that fetches files using getFileURL.
   *
   * This fallback implementation generates a URL using the provided getFileURL function
   * and then fetches the content using the fetch implementation. Used when no custom
   * loadFile function is provided in the constructor.
   *
   * @param fetchImpl - Fetch implementation to use for HTTP requests
   * @returns Function that loads file content from storage paths
   *
   * @private
   */
  private createDefaultLoadFile(
    fetchImpl: (url: string, options?: RequestInit) => Promise<Response>
  ) {
    return async (storagePath: string): Promise<string> => {
      try {
        // Get the URL for the file
        const fileURL = this.getFileURL(storagePath)

        // Fetch the file content
        const response = await fetchImpl(fileURL, {
          method: 'GET',
        })

        if (!response.ok) {
          if (response.status === 404) {
            throw new SHLManifestError(`File not found at storage path: ${storagePath}`)
          } else if (response.status === 429) {
            throw new SHLManifestRateLimitError('Too many requests to file storage')
          } else {
            throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
          }
        }

        // Return the file content as text
        return await response.text()
      } catch (error) {
        if (error instanceof SHLError) {
          throw error
        }
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new SHLNetworkError(`Failed to load file from storage: ${errorMessage}`)
      }
    }
  }

  /**
   * Add a SMART Health Card file to the manifest.
   *
   * Encrypts the Smart Health Card as a JWE file and uploads it to storage.
   * The SHC is wrapped in a `verifiableCredential` array as per SMART Health Cards specification.
   *
   * @param params - Configuration for adding the health card
   * @param params.shc - Smart Health Card to add. Can be a JWS string or SmartHealthCard object.
   *   If SmartHealthCard object, will call `asJWS()` to get the JWS representation.
   * @param params.enableCompression - Whether to compress the file content before encryption.
   *   Defaults to false since Smart Health Cards are already optimally compressed.
   *   Enable only if you need additional space savings and can accept the processing overhead.
   *
   * @throws {@link SHLError} When encryption fails
   *
   * @example
   * ```typescript
   * // Add from SmartHealthCard object
   * await builder.addHealthCard({ shc: mySmartHealthCard });
   *
   * // Add from JWS string
   * await builder.addHealthCard({ shc: 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjNLZmRnLVh3UC03Z...' });
   *
   * // Add with compression (not recommended for SHCs)
   * await builder.addHealthCard({
   *   shc: mySmartHealthCard,
   *   enableCompression: true
   * });
   * ```
   */
  async addHealthCard(params: {
    /** SMART Health Card JWS string or SmartHealthCard object */
    shc: SmartHealthCard | string
    /** Optional: Enable compression (default: false, as SHC is already compressed by default) */
    enableCompression?: boolean
  }): Promise<void> {
    const jwsString = typeof params.shc === 'string' ? params.shc : params.shc.asJWS()
    const fileContent = JSON.stringify({ verifiableCredential: [jwsString] })

    const encryptedFile = await this.encryptFile({
      content: fileContent,
      type: 'application/smart-health-card',
      enableCompression: params.enableCompression ?? false,
    })

    // Upload the encrypted file and store metadata
    const storagePath = await this.uploadFile(encryptedFile.jwe, encryptedFile.type)

    this._files.push({
      type: encryptedFile.type,
      storagePath,
      ciphertextLength: encryptedFile.jwe.length,
    })
  }

  /**
   * Add a FHIR JSON resource file to the manifest.
   *
   * Encrypts the FHIR resource as a JWE file and uploads it to storage.
   * The resource is serialized as JSON and can be any valid FHIR R4 resource.
   *
   * @param params - Configuration for adding the FHIR resource
   * @param params.content - FHIR R4 resource object to add.
   *   Must have a valid `resourceType` field. Can be any FHIR resource (Patient, Bundle, Observation, etc.)
   * @param params.enableCompression - Whether to compress the file content before encryption.
   *   Defaults to true since FHIR JSON can be verbose and benefits from compression.
   *   Compression uses raw DEFLATE (zip=DEF in JWE header).
   *
   * @throws {@link SHLError} When encryption fails
   *
   * @example
   * ```typescript
   * // Add a FHIR Bundle
   * await builder.addFHIRResource({
   *   content: {
   *     resourceType: 'Bundle',
   *     type: 'collection',
   *     entry: [
   *       { resource: { resourceType: 'Patient', id: '123', ... } },
   *       // ... more resources
   *     ]
   *   }
   * });
   *
   * // Add without compression
   * await builder.addFHIRResource({
   *   content: myFhirResource,
   *   enableCompression: false
   * });
   * ```
   */
  async addFHIRResource(params: {
    /** FHIR resource object */
    content: Resource
    /** Optional: Enable compression (default: true) */
    enableCompression?: boolean
  }): Promise<void> {
    const fileContent = JSON.stringify(params.content)

    const encryptedFile = await this.encryptFile({
      content: fileContent,
      type: 'application/fhir+json',
      enableCompression: params.enableCompression ?? true,
    })

    // Upload the encrypted file and store metadata
    const storagePath = await this.uploadFile(encryptedFile.jwe, encryptedFile.type)

    this._files.push({
      type: encryptedFile.type,
      storagePath,
      ciphertextLength: encryptedFile.jwe.length,
    })
  }

  /**
   * Get the SHL instance used by this builder.
   *
   * Returns the immutable SHL that contains the encryption key and manifest URL
   * for this builder's files.
   *
   * @returns The SHL instance provided in the constructor
   */
  get shl(): SHL {
    return this._shl
  }

  /**
   * Get the manifest ID for the SHL instance used by this builder.
   *
   * Useful for storing the SHL and its manifest in a database with a unique identifier.
   *
   * The manifest ID is the 43-character base64url-encoded entropy segment
   * that uniquely identifies this SHL's manifest URL. This ID is extracted
   * from the manifest URL path and can be used as a database key or identifier.
   *
   * For example, if the manifest URL is:
   * 'https://shl.example.org/manifests/abc123def456.../manifest.json'
   * The manifest ID would be: 'abc123def456...'
   *
   * @returns The 43-character manifest ID string
   * @throws {SHLManifestError} If the manifest URL cannot be parsed to extract the ID
   *
   * @example
   * ```typescript
   * const manifestId = builder.manifestId;
   * console.log('Database key:', manifestId); // 'abc123def456...'
   * ```
   */
  get manifestId(): string {
    const manifestURL = this._shl.url

    // Extract the entropy segment from the manifest URL
    // Expected format: https://domain/path/to/entropy/manifest.json
    // We need to find the second-to-last path segment (the entropy)
    const url = new URL(manifestURL)
    const pathSegments = url.pathname.split('/').filter(segment => segment.length > 0)

    if (pathSegments.length < 2) {
      throw new SHLManifestError(`Invalid manifest URL format: ${manifestURL}`)
    }

    // The entropy is the second-to-last segment
    const entropySegment = pathSegments[pathSegments.length - 2]

    // Check if the segment exists
    if (!entropySegment) {
      throw new SHLManifestError(`Could not find entropy segment in path: ${url.pathname}`)
    }

    // Validate that it's a 43-character base64url string
    if (entropySegment.length !== 43) {
      throw new SHLManifestError(
        `Invalid entropy segment length: expected 43, got ${entropySegment.length}`
      )
    }

    // Basic validation that it looks like base64url (alphanumeric, -, _)
    if (!/^[A-Za-z0-9_-]{43}$/.test(entropySegment)) {
      throw new SHLManifestError(`Invalid entropy segment format: ${entropySegment}`)
    }

    return entropySegment
  }

  /**
   * Get the current list of files in the manifest.
   *
   * Returns metadata about all files that have been added to the builder.
   * Does not include the actual file content, only the storage paths,
   * content types, and ciphertext lengths.
   *
   * @returns Array of file metadata objects (copies, safe to modify)
   */
  get files(): SerializedSHLManifestBuilderFile[] {
    return [...this._files]
  }

  /**
   * Build the manifest as JSON.
   *
   * Generates a fresh manifest response with up-to-date file descriptors.
   * Files are either embedded directly in the manifest or referenced by
   * location URLs based on the size threshold. Location URLs are generated
   * fresh each time to ensure security and proper access control.
   *
   * @param params.embeddedLengthMax - Maximum size in bytes for embedded files.
   *   Files with ciphertext length ≤ this value will be embedded directly in the manifest.
   *   Files larger than this will be referenced by location URLs.
   *   Defaults to 16384 (16 KiB). Typical range: 4096-32768.
   * @returns Promise resolving to SHL manifest object conforming to v1 specification
   * @throws {@link SHLManifestError} When a stored file cannot be loaded or content is missing
   * @throws {@link SHLManifestRateLimitError} When storage requests are rate limited
   * @throws {@link SHLNetworkError} When storage network requests fail
   *
   * @example
   * ```typescript
   * // Use default 16KB threshold
   * const manifest = await builder.buildManifest();
   *
   * // Prefer smaller embedded files (4KB)
   * const manifest = await builder.buildManifest({ embeddedLengthMax: 4096 });
   *
   * // Prefer larger embedded files (32KB)
   * const manifest = await builder.buildManifest({ embeddedLengthMax: 32768 });
   * ```
   */
  async buildManifest(params: { embeddedLengthMax?: number } = {}): Promise<SHLManifestV1> {
    const embeddedLengthMax = params.embeddedLengthMax ?? 16384 // 16 KiB default

    const manifestFiles: SHLManifestFileDescriptor[] = []

    for (const file of this._files) {
      if (file.ciphertextLength <= embeddedLengthMax) {
        // Embed the file directly - load the ciphertext from storage
        const ciphertext = await this.loadFile(file.storagePath)
        manifestFiles.push({
          contentType: file.type,
          embedded: ciphertext,
        })
      } else {
        // Reference file by location with fresh short-lived URL
        const fileURL = this.getFileURL(file.storagePath)

        manifestFiles.push({
          contentType: file.type,
          location: fileURL,
        })
      }
    }

    return { files: manifestFiles }
  }

  /**
   * Return serialized builder state for persistence.
   *
   * Returns a JSON-serializable object containing the SHL payload and file metadata.
   * This is NOT the same as an SHLManifestV1 - it's the builder's internal state
   * that can be stored in a database and used to reconstruct the builder later.
   *
   * The serialized state includes:
   * - SHL payload (url, key, expiration, flags, label)
   * - File metadata (content types, storage paths, ciphertext lengths)
   *
   * Does NOT include:
   * - Actual file content (stored separately via uploadFile)
   * - Short-lived URLs (generated fresh via getFileURL)
   *
   * @returns Serialized builder state suitable for database storage
   *
   * @example
   * ```typescript
   * // Serialize for storage
   * const builderState = builder.serialize();
   * await database.saveSHLBuilder(shlId, builderState);
   *
   * // Later, reconstruct the builder
   * const savedState = await database.loadSHLBuilder(shlId);
   * const reconstructedBuilder = SHLManifestBuilder.deserialize({
   *   data: savedState,
   *   uploadFile: myUploadFunction,
   *   getFileURL: myGetURLFunction
   * });
   * ```
   */
  serialize(): SerializedSHLManifestBuilder {
    return {
      shl: this._shl.payload,
      files: [...this._files],
    }
  }

  /**
   * Reconstruct a builder from serialized state.
   *
   * Creates a new SHLManifestBuilder instance from previously serialized state.
   * The SHL instance is reconstructed from the saved payload, and the file
   * metadata is restored. The provided functions are used for future file operations.
   *
   * @param params.data - Serialized builder state from a previous `serialize()` call
   * @param params.uploadFile - Function to upload encrypted files (same signature as constructor)
   * @param params.getFileURL - Function to generate file URLs (same signature as constructor)
   * @param params.loadFile - Optional function to load file content (same signature as constructor)
   * @param params.fetch - Optional fetch implementation for default loadFile (same signature as constructor)
   * @returns New SHLManifestBuilder instance with restored state
   *
   * @example
   * ```typescript
   * // Load from database
   * const savedState = await database.loadSHLBuilder(shlId);
   *
   * // Reconstruct builder
   * const builder = SHLManifestBuilder.deserialize({
   *   data: savedState,
   *   uploadFile: async (content) => await storage.upload(content),
   *   getFileURL: (path) => storage.getSignedURL(path),
   *   loadFile: async (path) => await storage.download(path)
   * });
   *
   * // Builder is ready to use
   * const manifest = await builder.buildManifest();
   * ```
   */
  static deserialize(params: {
    data: SerializedSHLManifestBuilder
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => string
    loadFile?: (path: string) => Promise<string>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }): SHLManifestBuilder {
    // Reconstruct the SHL instance
    const shl = SHL.fromPayload(params.data.shl)

    // Create the builder
    const builder = new SHLManifestBuilder({
      shl,
      uploadFile: params.uploadFile,
      getFileURL: params.getFileURL,
      ...(params.loadFile && { loadFile: params.loadFile }),
      ...(params.fetch && { fetch: params.fetch }),
    })

    // Restore the file metadata
    builder._files.push(...params.data.files)

    return builder
  }

  /**
   * Encrypt a file into JWE format using the SHL's encryption key.
   *
   * Uses JWE Compact Serialization with:
   * - Algorithm: 'dir' (direct key agreement)
   * - Encryption: 'A256GCM' (AES-256 in GCM mode)
   * - Compression: Optional 'DEF' (raw DEFLATE) when enabled
   * - Content Type: Set in 'cty' header for proper decryption
   *
   * @param params.content - Content to encrypt (JSON string)
   * @param params.type - Content type for the cty header
   * @param params.enableCompression - Whether to compress before encryption
   * @returns Promise resolving to encrypted file object with JWE and metadata
   *
   * @private
   */
  private async encryptFile(params: {
    content: string
    type: SHLFileContentType
    enableCompression?: boolean
  }): Promise<SHLFileJWE> {
    const jwe = await encryptSHLFile({
      content: params.content,
      key: this._shl.key,
      contentType: params.type,
      enableCompression: params.enableCompression ?? false,
    })

    return {
      type: params.type,
      jwe,
    }
  }
}
