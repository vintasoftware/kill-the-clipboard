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
 * This class handles file encryption and manifest building.
 *
 * Per the SHL specification, the server SHALL persist the builder state (not the manifest)
 * and generate fresh manifests with short-lived URLs on each request.
 *
 * @public
 * @category SHL High-Level API
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
   * @param params.shl - The immutable SHL instance this builder manages
   * @param params.uploadFile - Function to upload encrypted files to the server. Returns the path segment of the file in the server to be used by `getFileURL`.
   * @param params.getFileURL - Function to get the URL of a file that is already uploaded to the server. Per spec, this URL SHALL be short-lived and intended for single use.
   * @param params.loadFile - Optional function to load encrypted file content from storage. If not provided, defaults to fetching via `getFileURL()`.
   * @param params.fetch - Optional fetch implementation for the default loadFile (defaults to global fetch).
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
   * This is used when no custom loadFile function is provided.
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

  /** Add a SMART Health Card file to the manifest. Encrypts and uploads the file as JWE to the server. */
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

  /** Add a FHIR JSON file to the manifest. Encrypts and uploads the file as JWE to the server. */
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

  /** Get the SHL instance used by this builder. */
  get shl(): SHL {
    return this._shl
  }

  /** Get the current list of files in the manifest. */
  get files(): SerializedSHLManifestBuilderFile[] {
    return [...this._files]
  }

  /**
   * Build the manifest as JSON. Considers embedded vs location files based on size thresholds.
   * Generates fresh short-lived URLs per request as per SHL specification.
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
   * Return serialized builder state for persistence (NOT SHLManifestV1).
   * Server stores this JSON in DB and reconstructs the builder on demand.
   */
  serialize(): SerializedSHLManifestBuilder {
    return {
      shl: this._shl.payload,
      files: [...this._files],
    }
  }

  /**
   * Reconstruct a builder from serialized state.
   * The baseURL and manifestPath are extracted from the serialized SHL payload.
   */
  static deserialize(params: {
    data: SerializedSHLManifestBuilder
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>
    getFileURL: (path: string) => string
    loadFile?: (path: string) => Promise<string>
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }): SHLManifestBuilder {
    // Extract base URL and manifest path from the payload URL
    const manifestURL = new URL(params.data.shl.url)
    const baseURL = manifestURL.origin
    const manifestPath = manifestURL.pathname

    // Reconstruct the SHL instance
    const shl = SHL.fromPayload(params.data.shl, baseURL, manifestPath)

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

  /** Encrypt a file into JWE (A256GCM, zip=DEF) using the SHL's encryption key */
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
