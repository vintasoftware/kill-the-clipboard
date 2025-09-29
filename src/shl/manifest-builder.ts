import type { List, Resource } from '@medplum/fhirtypes'
import type { SHC } from '../shc/shc.js'
import { encryptSHLFile } from './crypto.js'
import { SHLError, SHLExpiredError, SHLManifestError, SHLNetworkError } from './errors.js'
import { SHL } from './shl.js'
import type {
  SHLFileContentType,
  SHLFileJWE,
  SHLManifestBuilderDBAttrs,
  SHLManifestFileDBAttrs,
  SHLManifestFileDescriptor,
  SHLManifestV1,
  SHLPayloadV1,
} from './types.js'

/**
 * Class that builds the manifest and files for a SMART Health Link.
 *
 * This class handles file encryption, upload, and manifest building for SHL content.
 * It encrypts files using JWE with A256GCM, manages file storage through provided
 * upload/retrieval functions, and generates manifests with embedded or location-based
 * file descriptors based on size thresholds.
 *
 * Per the SHL specification, servers SHALL generate manifests with short-lived URLs
 * on each request. This ensures URLs remain secure and can be rotated frequently.
 * For this to work, the `SHLManifestBuilder` must be reconstructed on each request.
 * Use the `toDBAttrs` to persist the builder state after the SHL is created,
 * and the `fromDBAttrs` to reconstruct the builder when handling each manifest request.
 *
 * The builder supports:
 * - FHIR JSON resources
 * - SMART Health Card files (JWS format)
 * - Optional compression with raw DEFLATE
 * - Embedded vs location-based file serving
 * - toDBAttrs/fromDBAttrs for persistence
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
 *   },
 *   maxParallelism: 3 // Process up to 3 files concurrently
 * });
 *
 * // Add files
 * await builder.addHealthCard({ shc: mySHC });
 * await builder.addFHIRResource({ content: myFhirBundle });
 *
 * // Generate manifest
 * const manifest = await builder.buildManifest({ embeddedLengthMax: 16384 });
 * ```
 *
 * @public
 * @group SHL
 * @category High-Level API
 */
export class SHLManifestBuilder {
  private readonly _shl: SHL
  private readonly uploadFile: (
    content: string,
    contentType?: SHLFileContentType
  ) => Promise<string>
  private readonly getFileURL: (path: string) => Promise<string>
  private readonly loadFile: (path: string) => Promise<string>
  private readonly _removeFile?: ((path: string) => Promise<void>) | undefined
  private readonly updateFile?:
    | ((path: string, content: string, contentType?: SHLFileContentType) => Promise<void>)
    | undefined
  private readonly _files: SHLManifestFileDBAttrs[] = []
  private readonly maxParallelism: number

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
   * @param params.removeFile - Optional function to remove files from storage.
   *   Receives a storage path and removes the file. Required for file removal operations.
   * @param params.updateFile - Optional function to update files in storage.
   *   Receives a storage path, new content, and optional content type. Required for file update operations.
   * @param params.fetch - Optional fetch implementation for the default loadFile.
   *   Only used if `loadFile` is not provided. Defaults to global fetch.
   * @param params.maxParallelism - Optional maximum number of concurrent file operations.
   *   Defaults to 5. Used for parallelizing file loading and URL generation in buildManifest.
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
   *   getFileURL: async (path) => {
   *     return s3.getSignedUrl('getObject', { Key: path, Expires: 3600 });
   *   },
   *   loadFile: async (path) => {
   *     const result = await s3.getObject({ Key: path });
   *     return result.Body.toString();
   *   },
   *   removeFile: async (path) => {
   *     await s3.deleteObject({ Key: path });
   *   },
   *   updateFile: async (path, content, contentType) => {
   *     await s3.putObject({ Key: path, Body: content, ContentType: 'application/jose' });
   *   },
   *   maxParallelism: 10
   * });
   * ```
   */
  constructor(params: {
    shl: SHL
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => Promise<string>
    loadFile?: (path: string) => Promise<string>
    removeFile?: (path: string) => Promise<void>
    updateFile?: (path: string, content: string, contentType?: SHLFileContentType) => Promise<void>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
    maxParallelism?: number
  }) {
    this._shl = params.shl
    this.uploadFile = params.uploadFile
    this.getFileURL = params.getFileURL
    this._removeFile = params.removeFile
    this.updateFile = params.updateFile
    this.maxParallelism = params.maxParallelism ?? 5

    if (this.maxParallelism <= 0) {
      throw new SHLManifestError('maxParallelism must be greater than 0')
    }

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
   * @throws {@link SHLNetworkError} When file cannot be loaded
   *
   * @private
   */
  private createDefaultLoadFile(
    fetchImpl: (url: string, options?: RequestInit) => Promise<Response>
  ) {
    return async (storagePath: string): Promise<string> => {
      try {
        // Get the URL for the file
        const fileURL = await this.getFileURL(storagePath)

        // Fetch the file content
        const response = await fetchImpl(fileURL, {
          method: 'GET',
        })

        if (!response.ok) {
          if (response.status === 404) {
            throw new SHLNetworkError(`File not found at URL: ${fileURL}`)
          } else {
            throw new SHLNetworkError(
              `Failed to fetch file from storage at ${fileURL}, got HTTP ${response.status}: ${response.statusText}`
            )
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
   * Encrypts the SMART Health Card as a JWE file and uploads it to storage.
   * The SHC is wrapped in a `verifiableCredential` array as per SMART Health Cards specification.
   *
   * @param params - Configuration for adding the health card. The object should contain:
   *   - `shc`: SMART Health Card to add (JWS string or SHC object)
   *   - `enableCompression`: Optional. Whether to compress the file content before encryption (defaults to false, as SHCs are typically already compressed)
   * @returns Promise resolving to object with encrypted file metadata and storage path
   * @returns returns.encryptedFile - Encrypted file object with type and JWE string
   * @returns returns.storagePath - Storage key/path returned by the upload function
   * @returns returns.ciphertextLength - Length of the JWE ciphertext string
   *
   * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
   *
   * @example
   * ```typescript
   * // Add from SHC object
   * const result = await builder.addHealthCard({ shc: mySHC });
   * console.log('Added file:', result.storagePath, 'Size:', result.ciphertextLength);
   *
   * // Add from JWS string
   * await builder.addHealthCard({ shc: 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjNLZmRnLVh3UC03Z...' });
   *
   * // Add with compression (not recommended for SHCs)
   * await builder.addHealthCard({
   *   shc: mySHC,
   *   enableCompression: true
   * });
   * ```
   */
  async addHealthCard(params: {
    shc: SHC | string
    enableCompression?: boolean
  }): Promise<{ encryptedFile: SHLFileJWE; storagePath: string; ciphertextLength: number }> {
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
      lastUpdated: new Date().toISOString(),
    })
    return { encryptedFile, storagePath, ciphertextLength: encryptedFile.jwe.length }
  }

  /**
   * Add a FHIR JSON resource file to the manifest.
   *
   * Encrypts the FHIR resource as a JWE file and uploads it to storage.
   * The resource is serialized as JSON and can be any valid FHIR R4 resource.
   *
   * @param params - Configuration for adding the FHIR resource. The object should contain:
   *   - `content`: FHIR R4 resource object to add (must have valid `resourceType` field)
   *   - `enableCompression`: Optional. Whether to compress the file content before encryption (defaults to true)
   * @returns Promise resolving to object with encrypted file metadata and storage path
   * @returns returns.encryptedFile - Encrypted file object with type and JWE string
   * @returns returns.storagePath - Storage key/path returned by the upload function
   * @returns returns.ciphertextLength - Length of the JWE ciphertext string
   *
   * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
   *
   * @example
   * ```typescript
   * // Add a FHIR Bundle
   * const result = await builder.addFHIRResource({
   *   content: {
   *     resourceType: 'Bundle',
   *     type: 'collection',
   *     entry: [
   *       { resource: { resourceType: 'Patient', id: '123', ... } },
   *       // ... more resources
   *     ]
   *   }
   * });
   * console.log('Added FHIR resource:', result.storagePath, 'Size:', result.ciphertextLength);
   * ```
   */
  async addFHIRResource(params: {
    content: Resource
    enableCompression?: boolean
  }): Promise<{ encryptedFile: SHLFileJWE; storagePath: string; ciphertextLength: number }> {
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
      lastUpdated: new Date().toISOString(),
    })
    return { encryptedFile, storagePath, ciphertextLength: encryptedFile.jwe.length }
  }

  /**
   * Remove a file from the manifest and storage.
   *
   * Removes the file metadata from the builder's internal state and calls the
   * `removeFile` function to delete the actual file from storage.
   * The file is identified by its storage path.
   *
   * @param storagePath - Storage path of the file to remove (as returned by uploadFile)
   * @returns Promise that resolves when the file is removed from both manifest and storage
   * @throws {@link SHLManifestError} When removeFile function is not provided or file not found
   * @throws {@link SHLNetworkError} When storage removal fails
   *
   * @example
   * ```typescript
   * // Remove a specific file
   * // Note: This requires providing removeFile function in constructor
   * await builder.removeFile('shl-files/abc123.jwe');
   * ```
   */
  async removeFile(storagePath: string): Promise<void> {
    if (!this._removeFile) {
      throw new SHLManifestError(
        'File removal is not supported. Provide a removeFile function in the constructor to enable file removal.'
      )
    }

    // Find the file in the manifest
    const fileIndex = this._files.findIndex(file => file.storagePath === storagePath)
    if (fileIndex === -1) {
      throw new SHLManifestError(`File with storage path '${storagePath}' not found in manifest`)
    }

    try {
      // Remove from storage first
      await this._removeFile(storagePath)

      // Remove from manifest
      this._files.splice(fileIndex, 1)
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to remove file from storage: ${errorMessage}`)
    }
  }

  /**
   * Update a FHIR resource file in the manifest and storage.
   *
   * Replaces an existing FHIR resource file with new content. The file is identified
   * by its storage path. The updated content is encrypted and stored using the same
   * storage path, and the manifest metadata is updated accordingly.
   *
   * @param storagePath - Storage path of the file to update (as returned by uploadFile)
   * @param content - New FHIR resource content to store
   * @param enableCompression - Whether to compress the file content before encryption (defaults to true)
   * @param lastUpdated - Optional custom timestamp for the update. If not provided,
   *   the current time will be used.
   * @returns Promise that resolves when the file is updated in both manifest and storage
   * @throws {@link SHLManifestError} When updateFile function is not provided, file not found, or file is not a FHIR resource
   * @throws {@link SHLNetworkError} When storage update fails
   * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
   *
   * @example
   * ```typescript
   * // Update a FHIR Bundle
   * // Note: This requires providing updateFile function in constructor
   * await builder.updateFHIRResource('shl-files/bundle123.jwe', {
   *   resourceType: 'Bundle',
   *   type: 'collection',
   *   entry: [
   *     { resource: { resourceType: 'Patient', id: '456', ... } }
   *   ]
   * });
   * ```
   */
  async updateFHIRResource(
    storagePath: string,
    content: Resource,
    enableCompression?: boolean,
    lastUpdated?: Date
  ): Promise<void> {
    if (!this.updateFile) {
      throw new SHLManifestError(
        'File updates are not supported. Provide an updateFile function in the constructor to enable file updates.'
      )
    }

    // Find the file in the manifest
    const fileIndex = this._files.findIndex(file => file.storagePath === storagePath)
    if (fileIndex === -1) {
      throw new SHLManifestError(`File with storage path '${storagePath}' not found in manifest`)
    }

    const existingFile = this._files[fileIndex]
    if (!existingFile) {
      throw new SHLManifestError(`File with storage path '${storagePath}' not found in manifest`)
    }

    if (existingFile.type !== 'application/fhir+json') {
      throw new SHLManifestError(
        `File at storage path '${storagePath}' is not a FHIR resource (type: ${existingFile.type})`
      )
    }

    try {
      // Encrypt the new content
      const encryptedFile = await this.encryptFile({
        content: JSON.stringify(content),
        type: 'application/fhir+json',
        enableCompression: enableCompression ?? true,
      })

      // Update in storage
      await this.updateFile(storagePath, encryptedFile.jwe, encryptedFile.type)

      // Update manifest metadata
      this._files[fileIndex] = {
        type: encryptedFile.type,
        storagePath,
        ciphertextLength: encryptedFile.jwe.length,
        lastUpdated: (lastUpdated ?? new Date()).toISOString(),
      }
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to update FHIR resource in storage: ${errorMessage}`)
    }
  }

  /**
   * Update a SMART Health Card file in the manifest and storage.
   *
   * Replaces an existing SMART Health Card file with new content. The file is identified
   * by its storage path. The updated content is encrypted and stored using the same
   * storage path, and the manifest metadata is updated accordingly.
   *
   * @param storagePath - Storage path of the file to update (as returned by uploadFile)
   * @param shc - New SMART Health Card to store (JWS string or SHC object)
   * @param enableCompression - Whether to compress the file content before encryption (defaults to false for SHCs)
   * @param lastUpdated - Optional custom timestamp for the update. If not provided,
   *   the current time will be used.
   * @returns Promise that resolves when the file is updated in both manifest and storage
   * @throws {@link SHLManifestError} When updateFile function is not provided, file not found, or file is not a SMART Health Card
   * @throws {@link SHLNetworkError} When storage update fails
   * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
   *
   * @example
   * ```typescript
   * // Update with SHC object
   * // Note: This requires providing updateFile function in constructor
   * await builder.updateHealthCard('shl-files/card123.jwe', myUpdatedHealthCard);
   *
   * // Update with JWS string
   * await builder.updateHealthCard('shl-files/card123.jwe', 'eyJhbGciOiJFUzI1NiIsImtpZCI6...');
   * ```
   */
  async updateHealthCard(
    storagePath: string,
    shc: SHC | string,
    enableCompression?: boolean,
    lastUpdated?: Date
  ): Promise<void> {
    if (!this.updateFile) {
      throw new SHLManifestError(
        'File updates are not supported. Provide an updateFile function in the constructor to enable file updates.'
      )
    }

    // Find the file in the manifest
    const fileIndex = this._files.findIndex(file => file.storagePath === storagePath)
    if (fileIndex === -1) {
      throw new SHLManifestError(`File with storage path '${storagePath}' not found in manifest`)
    }

    const existingFile = this._files[fileIndex]
    if (!existingFile) {
      throw new SHLManifestError(`File with storage path '${storagePath}' not found in manifest`)
    }

    if (existingFile.type !== 'application/smart-health-card') {
      throw new SHLManifestError(
        `File at storage path '${storagePath}' is not a SMART Health Card (type: ${existingFile.type})`
      )
    }

    try {
      // Prepare content in SHC format
      const jwsString = typeof shc === 'string' ? shc : shc.asJWS()
      const fileContent = JSON.stringify({ verifiableCredential: [jwsString] })

      // Encrypt the new content
      const encryptedFile = await this.encryptFile({
        content: fileContent,
        type: 'application/smart-health-card',
        enableCompression: enableCompression ?? false,
      })

      // Update in storage
      await this.updateFile(storagePath, encryptedFile.jwe, encryptedFile.type)

      // Update manifest metadata
      this._files[fileIndex] = {
        type: encryptedFile.type,
        storagePath,
        ciphertextLength: encryptedFile.jwe.length,
        lastUpdated: (lastUpdated ?? new Date()).toISOString(),
      }
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to update SMART Health Card in storage: ${errorMessage}`)
    }
  }

  /**
   * Find a file in the manifest by storage path.
   *
   * Returns the file metadata for the specified storage path, or null if not found.
   * Useful for checking if a file exists before attempting updates or for getting
   * file information.
   *
   * @param storagePath - Storage path to search for
   * @returns File metadata object or null if not found
   *
   * @example
   * ```typescript
   * const fileInfo = builder.findFile('shl-files/bundle123.jwe');
   * if (fileInfo) {
   *   console.log('File type:', fileInfo.type);
   *   console.log('File size:', fileInfo.ciphertextLength);
   * } else {
   *   console.log('File not found');
   * }
   * ```
   */
  findFile(storagePath: string): SHLManifestFileDBAttrs | null {
    return this._files.find(file => file.storagePath === storagePath) ?? null
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
    // Expected formats:
    //   - https://domain/path/to/entropy/manifest.json
    //   - https://domain/path/to/entropy/
    // We need to find the second-to-last path segment (the entropy)
    const url = new URL(manifestURL)
    const pathSegments = url.pathname.split('/')

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
  get files(): SHLManifestFileDBAttrs[] {
    return [...this._files]
  }

  /**
   * Build the manifest as JSON.
   *
   * Generates a fresh manifest response with up-to-date file descriptors.
   * Files are either embedded directly in the manifest or referenced by
   * location URLs based on the size threshold. Location URLs are generated
   * fresh each time to ensure security and proper access control.
   * `embeddedLengthMax` may vary per request.
   *
   * @param params.embeddedLengthMax - Maximum size in bytes for embedded files.
   *   Files with ciphertext length ≤ this value will be embedded directly in the manifest.
   *   Files larger than this will be referenced by location URLs.
   *   Defaults to 16384 (16 KiB). Typical range: 4096-32768.
   * @param params.status - Optional value indicating whether files may change in the future.
   *   When provided, will be included in the manifest root.
   * @param params.list - Optional FHIR List resource to include in the manifest root.
   *   Provides metadata about the collection of files.
   * @returns Promise resolving to SHL manifest object conforming to v1 specification ({@link SHLManifestV1})
   * @throws {@link SHLExpiredError} When the SHL has expired (exp field < current time)
   * @throws {@link SHLManifestError} When a stored file cannot be loaded or content is missing
   * @throws {@link SHLNetworkError} When storage network requests fail
   *
   * @example
   * ```typescript
   * // Use default settings
   * const manifest = await builder.buildManifest();
   *
   * // Custom settings with can-change status and FHIR List
   * const manifest = await builder.buildManifest({
   *   embeddedLengthMax: 4096,
   *   status: "can-change",
   *   list: {
   *     resourceType: 'List',
   *     status: 'current',
   *     mode: 'working',
   *     title: 'Patient Summary'
   *   }
   * });
   * ```
   */
  async buildManifest(
    params: { embeddedLengthMax?: number; status?: SHLManifestV1['status']; list?: List } = {}
  ): Promise<SHLManifestV1> {
    const embeddedLengthMax = params.embeddedLengthMax ?? 16384 // 16 KiB default
    const status = params.status
    const list = params.list

    // Check expiration
    if (this._shl.exp && this._shl.exp < Math.floor(Date.now() / 1000)) {
      throw new SHLExpiredError('SHL has expired')
    }

    const manifestFiles: SHLManifestFileDescriptor[] = []

    try {
      const fileDescriptors = await this.processBatches(
        this._files,
        async (file): Promise<SHLManifestFileDescriptor> => {
          const baseDescriptor = {
            ...(file.lastUpdated && { lastUpdated: file.lastUpdated }),
          }

          if (file.ciphertextLength <= embeddedLengthMax) {
            // Embed the file directly - load the ciphertext from storage
            const ciphertext = await this.loadFile(file.storagePath)
            return {
              contentType: file.type,
              embedded: ciphertext,
              ...baseDescriptor,
            }
          } else {
            // Reference file by location with fresh short-lived URL
            const fileURL = await this.getFileURL(file.storagePath)
            return {
              contentType: file.type,
              location: fileURL,
              ...baseDescriptor,
            }
          }
        }
      )

      manifestFiles.push(...fileDescriptors)
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      throw new SHLManifestError(
        `Failed to build manifest: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return {
      files: manifestFiles,
      ...(status && { status }),
      ...(list && { list }),
    }
  }

  /**
   * Return database attributes for DB persistence.
   * Use the {@link fromDBAttrs} method to reconstruct the builder later.
   *
   * Returns an object containing only the files metadata.
   * This is NOT the same as an SHLManifestV1 - it's the builder's internal state
   * that can be stored in a database and used to reconstruct the builder later.
   * The SHL payload should be stored separately in the database.
   *
   * The database attributes include:
   * - File metadata (content types, storage paths, ciphertext lengths)
   *
   * Does NOT include:
   * - SHL payload (stored separately in database)
   * - Actual file content (stored separately via uploadFile)
   * - Short-lived URLs (generated fresh via getFileURL)
   *
   * @returns Database attributes suitable for storage ({@link SHLManifestBuilderDBAttrs})
   *
   * @example
   * ```typescript
   * // Store for persistence (when creating the SHL)
   * await database.storeSHL(shlId, shl.payload);
   * const builderAttrs = builder.toDBAttrs();
   * await database.storeManifestBuilder(shlId, builderAttrs);
   *
   * // Later, reconstruct the builder (when serving the manifest)
   * const shlPayload = await database.getSHL(shlId);
   * const savedAttrs = await database.getManifestBuilder(shlId);
   * const reconstructedBuilder = SHLManifestBuilder.fromDBAttrs({
   *   attrs: savedAttrs,
   *   shl: shlPayload,
   *   uploadFile: myUploadFunction,
   *   getFileURL: myGetURLFunction
   * });
   * ```
   */
  toDBAttrs(): SHLManifestBuilderDBAttrs {
    return {
      files: [...this._files],
    }
  }

  /**
   * Process files in batches with controlled concurrency.
   *
   * @param files - Array of files to process
   * @param processor - Function to process each file
   * @returns Promise resolving to array of processing results
   * @private
   */
  private async processBatches<T, R>(items: T[], processor: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = []

    for (let i = 0; i < items.length; i += this.maxParallelism) {
      const batch = items.slice(i, i + this.maxParallelism)
      const batchResults = await Promise.all(batch.map(processor))
      results.push(...batchResults)
    }

    return results
  }

  /**
   * Reconstruct a builder from database attributes returned by {@link toDBAttrs} method.
   *
   * Creates a new SHLManifestBuilder instance from previously stored database attributes.
   * The provided functions are used for subsequent file operations.
   *
   * @param params.shl - SHL payload stored separately in database
   * @param params.attrs - Database attributes from a previous `toDBAttrs()` call
   * @param params.uploadFile - Function to upload encrypted files (same signature as constructor)
   * @param params.getFileURL - Function to generate file URLs (same signature as constructor)
   * @param params.loadFile - Optional function to load file content (same signature as constructor)
   * @param params.removeFile - Optional function to remove files (same signature as constructor)
   * @param params.updateFile - Optional function to update files (same signature as constructor)
   * @param params.fetch - Optional fetch implementation for default loadFile (same signature as constructor)
   * @param params.maxParallelism - Optional maximum number of concurrent file operations (same signature as constructor)
   * @returns New `SHLManifestBuilder` instance with restored state
   *
   * @example
   * ```typescript
   * // Load from database (when serving the manifest)
   * const savedAttrs = await database.getManifestBuilder(shlId);
   * const shlPayload = await database.getSHL(shlId);
   *
   * // Reconstruct builder (pass the same functions passed to the constructor)
   * const builder = SHLManifestBuilder.fromDBAttrs({
   *   shl: shlPayload,
   *   attrs: savedAttrs,
   *   uploadFile: async (content) => await storage.upload(content),
   *   getFileURL: async (path) => await storage.getSignedURL(path),
   *   loadFile: async (path) => await storage.download(path),
   *   removeFile: async (path) => await storage.delete(path),
   *   updateFile: async (path, content) => await storage.update(path, content)
   * });
   *
   * // Builder is ready to serve the manifest
   * const manifest = await builder.buildManifest();
   * ```
   */
  static fromDBAttrs(params: {
    shl: SHLPayloadV1
    attrs: SHLManifestBuilderDBAttrs
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => Promise<string>
    loadFile?: (path: string) => Promise<string>
    removeFile?: (path: string) => Promise<void>
    updateFile?: (path: string, content: string, contentType?: SHLFileContentType) => Promise<void>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
    maxParallelism?: number
  }): SHLManifestBuilder {
    // Reconstruct the SHL instance
    const shl = SHL.fromPayload(params.shl)

    // Create the builder
    const builder = new SHLManifestBuilder({
      shl,
      uploadFile: params.uploadFile,
      getFileURL: params.getFileURL,
      ...(params.loadFile && { loadFile: params.loadFile }),
      ...(params.removeFile && { removeFile: params.removeFile }),
      ...(params.updateFile && { updateFile: params.updateFile }),
      ...(params.fetch && { fetch: params.fetch }),
      ...(params.maxParallelism !== undefined && { maxParallelism: params.maxParallelism }),
    })

    // Restore the file metadata
    builder._files.push(...params.attrs.files)

    return builder
  }

  /**
   * Encrypt a file into JWE format using the SHL's encryption key.
   *
   * Uses JWE Compact Serialization with:
   * - Algorithm: 'dir' (direct key agreement)
   * - Encryption: 'A256GCM' (AES-256 in GCM mode)
   * - Content Type: Set in 'cty' header for proper decryption
   *
   * @param params.content - Content to encrypt (JSON string)
   * @param params.type - Content type for the cty header
   * @param params.enableCompression - Whether to compress before encryption
   * @returns Promise resolving to encrypted file object with JWE and metadata ({@link SHLFileJWE})
   * @throws {@link SHLEncryptionError} When encryption fails due to invalid key, content, or crypto operations
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
