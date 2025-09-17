import type { Resource } from '@medplum/fhirtypes'
import { SmartHealthCardReader } from '../shc/reader.js'
import type { SmartHealthCard } from '../shc/shc.js'
import type { SmartHealthCardReaderConfigParams } from '../shc/types.js'
import { decryptSHLFile } from './crypto.js'
import {
  SHLError,
  SHLExpiredError,
  SHLInvalidContentError,
  SHLInvalidPasscodeError,
  SHLManifestError,
  SHLManifestNotFoundError,
  SHLManifestRateLimitError,
  SHLNetworkError,
  SHLViewerError,
} from './errors.js'
import { SHL } from './shl.js'
import type {
  SHLFileContentType,
  SHLManifestRequestV1,
  SHLManifestV1,
  SHLResolvedContent,
} from './types.js'

/**
 * SHL Viewer handles parsing and resolving SMART Health Links.
 *
 * This class processes SHLink URIs and fetches/decrypts the referenced content.
 * It supports both embedded and location-based file descriptors, handles
 * passcode authentication, and validates manifest structures according to
 * the SMART Health Links specification.
 *
 * The viewer automatically handles:
 * - SHLink URI parsing and payload validation
 * - Manifest fetching with POST requests
 * - File decryption using JWE with A256GCM
 * - SMART Health Card and FHIR resource extraction
 *
 * @example
 * ```typescript
 * // Create viewer with SHLink URI
 * const viewer = new SHLViewer({
 *   shlinkURI: 'shlink:/eyJ1cmwiOi4uLn0',
 *   fetch: customFetch // optional custom fetch implementation
 * });
 *
 * // Resolve the SHLink (fetch and decrypt content)
 * const resolved = await viewer.resolveSHLink({
 *   recipient: 'Dr. Smith',
 *   passcode: 'secret123', // if P flag is set
 *   embeddedLengthMax: 16384 // prefer embedding files under 16KB
 * });
 *
 * console.log(resolved.smartHealthCards); // Array of SmartHealthCard objects
 * console.log(resolved.fhirResources); // Array of FHIR resources
 * ```
 *
 * @public
 * @group SHL
 * @category High-Level API
 */
export class SHLViewer {
  private readonly _shl: SHL
  private readonly fetchImpl: (url: string, options?: RequestInit) => Promise<Response>

  /**
   * Create an SHL viewer.
   *
   * The viewer can be created with or without an initial SHLink URI.
   * If no URI is provided, you can parse one later using the shl getter
   * after creating a viewer with a URI.
   *
   * @param params.shlinkURI - SHLink URI to parse.
   *   Supports both bare URIs (`shlink:/...`) and viewer-prefixed URIs (`https://viewer.example/#shlink:/...`)
   * @param params.fetch - Optional fetch implementation for network requests.
   *   Defaults to global fetch. Useful for testing or custom network handling.
   *
   * @example
   * ```typescript
   * // Create with immediate parsing
   * const viewer = new SHLViewer({
   *   shlinkURI: 'shlink:/eyJ1cmwiOi4uLn0'
   * });
   *
   * // Create with custom fetch
   * const viewer = new SHLViewer({
   *   shlinkURI: 'https://viewer.example/#shlink:/eyJ1cmwiOi4uLn0',
   *   fetch: myCustomFetch
   * });
   * ```
   */
  constructor(params: {
    shlinkURI: string
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }) {
    // Bind fetch to the global object to avoid "Illegal invocation" when called as a bare function
    const chosenFetch = params?.fetch ?? (globalThis as unknown as { fetch?: typeof fetch }).fetch
    if (typeof chosenFetch === 'function') {
      this.fetchImpl = chosenFetch.bind(globalThis) as (
        url: string,
        options?: RequestInit
      ) => Promise<Response>
    } else {
      throw new SHLViewerError(
        'Fetch is not available in this environment; provide a fetch implementation'
      )
    }

    this._shl = SHL.parse(params.shlinkURI)
  }

  /**
   * Get the parsed SHL object from the SHLink URI.
   *
   * Returns the SHL instance created from parsing the SHLink URI provided
   * to the constructor. Use this to access SHL properties like expiration,
   * flags, and manifest URL.
   *
   * @returns SHL instance with parsed payload data
   *
   * @example
   * ```typescript
   * const viewer = new SHLViewer({ shlinkURI: 'shlink:/...' });
   * const shl = viewer.shl;
   * console.log(shl.requiresPasscode); // Check if passcode needed
   * console.log(shl.expirationDate); // Check expiration
   * ```
   */
  get shl(): SHL {
    return this._shl
  }

  /**
   * Resolve a SHLink URI by fetching and decrypting all referenced content.
   *
   * This method performs the complete SHL resolution workflow:
   * 1. Validates SHL expiration and passcode requirements
   * 2. Fetches the manifest via POST request with recipient info
   * 3. Processes each file descriptor (embedded or location-based)
   * 4. Decrypts files using the SHL's encryption key
   * 5. Parses content based on type (SMART Health Cards or FHIR resources)
   * 6. Returns structured data ready for application use
   *
   * @param params.recipient - Required recipient identifier sent in manifest request.
   *   This should identify the requesting user/system (e.g., "Dr. Smith", "Patient Portal")
   * @param params.passcode - Optional passcode for P-flagged SHLinks.
   *   Required when SHL has 'P' flag, ignored otherwise.
   * @param params.embeddedLengthMax - Optional preference for embedded vs location files.
   *   Files smaller than this size (in bytes) will be embedded in manifest response.
   *   Servers may honor or cap this value per request. Typical values: 4096-16384.
   *
   * @param params.shcReaderConfig - Optional configuration for SMART Health Card verification (e.g. public key)
   *
   * @returns Promise resolving to structured content with manifest and decrypted files ({@link SHLResolvedContent})
   * @throws {@link SHLViewerError} When recipient is not a non-empty string
   * @throws {@link SHLExpiredError} When SHL has expired (exp field < current time)
   * @throws {@link SHLInvalidPasscodeError} When P-flagged SHL requires passcode but none provided, or passcode is incorrect
   * @throws {@link SHLManifestNotFoundError} When manifest URL returns 404
   * @throws {@link SHLManifestRateLimitError} When requests are rate limited (429)
   * @throws {@link SHLNetworkError} When network requests fail
   * @throws {@link SHLDecryptionError} When file decryption fails
   * @throws {@link SHLManifestError} When manifest structure is invalid or file content is malformed
   * @throws {@link SHLInvalidContentError} When file content is not valid JSON or invalid SHC/FHIR resource
   *
   * @example
   * ```typescript
   * const viewer = new SHLViewer({ shlinkURI: 'shlink:/...' });
   *
   * try {
   *   const resolved = await viewer.resolveSHLink({
   *     recipient: 'Dr. Smith - General Practice',
   *     passcode: viewer.shl.requiresPasscode ? 'user-provided-passcode' : undefined,
   *     embeddedLengthMax: 8192 // Prefer embedding files under 8KB
   *   });
   *
   *   // Process SMART Health Cards
   *   for (const shc of resolved.smartHealthCards) {
   *     console.log('SHC issuer:', shc.issuer);
   *     console.log('SHC data:', shc.fhirBundle);
   *   }
   *
   *   // Process FHIR resources
   *   for (const resource of resolved.fhirResources) {
   *     console.log('Resource type:', resource.resourceType);
   *   }
   * } catch (error) {
   *   if (error instanceof SHLExpiredError) {
   *     console.error('SHL has expired');
   *   } else if (error instanceof SHLInvalidPasscodeError) {
   *     console.error('Invalid or missing passcode');
   *   }
   *   // Handle other error types...
   * }
   * ```
   */
  async resolveSHLink(params: {
    passcode?: string
    recipient: string
    embeddedLengthMax?: number
    shcReaderConfig?: SmartHealthCardReaderConfigParams
  }): Promise<SHLResolvedContent> {
    const shl = this.shl

    // Validate recipient (required non-empty display string)
    if (typeof params.recipient !== 'string' || params.recipient.trim().length === 0) {
      throw new SHLViewerError('Recipient must be a non-empty string')
    }

    // Check expiration
    if (shl.exp && shl.exp < Math.floor(Date.now() / 1000)) {
      throw new SHLExpiredError('SHL has expired')
    }

    // Validate passcode requirement
    if (shl.requiresPasscode && !params.passcode) {
      throw new SHLInvalidPasscodeError('SHL requires a passcode')
    }

    // Direct-file (U flag) flow: GET the single encrypted file directly from shl.url
    if (shl.isDirectFile) {
      const decrypted = await this.fetchAndDecryptFile({
        url: shl.url,
        key: shl.key,
        recipient: params.recipient,
      })
      const parsed = await this.parseDecrypted(
        [
          {
            content: decrypted.content,
            contentType: decrypted.contentType,
          },
        ],
        params.shcReaderConfig
      )
      return {
        manifest: undefined,
        smartHealthCards: parsed.smartHealthCards,
        fhirResources: parsed.fhirResources,
      }
    }

    // Manifest-based flow
    const manifest = await this.fetchManifest({
      url: shl.url,
      recipient: params.recipient,
      ...(params.passcode && { passcode: params.passcode }),
      ...(params.embeddedLengthMax !== undefined && {
        embeddedLengthMax: params.embeddedLengthMax,
      }),
    })

    const decryptedFiles = await this.decryptFiles(manifest)
    const { smartHealthCards, fhirResources } = await this.parseDecrypted(
      decryptedFiles,
      params.shcReaderConfig
    )

    return { manifest, smartHealthCards, fhirResources }
  }

  /**
   * Fetch a manifest from the given URL.
   *
   * Makes a POST request to the manifest URL with a JSON body containing
   * recipient information and optional passcode/embedding preferences.
   * Handles HTTP error responses and validates the returned manifest structure.
   *
   * @param params.url - Manifest URL from SHL payload
   * @param params.recipient - Recipient identifier for the manifest request
   * @param params.passcode - Optional passcode for P-flagged SHLinks
   * @param params.embeddedLengthMax - Optional preference for embedded file size limit
   * @returns Promise resolving to validated manifest object ({@link SHLManifestV1})
   * @throws {@link SHLInvalidPasscodeError} When server returns 401 (invalid/missing passcode)
   * @throws {@link SHLManifestNotFoundError} When server returns 404 (manifest not found)
   * @throws {@link SHLManifestRateLimitError} When server returns 429 (rate limited)
   * @throws {@link SHLNetworkError} When other HTTP errors occur or network fails
   * @throws {@link SHLManifestError} When manifest response is not valid JSON or has invalid structure
   *
   *
   * @example
   * ```typescript
   * const viewer = new SHLViewer({ shlinkURI: 'shlink:/...' });
   * const manifest = await viewer.fetchManifest({
   *   url: viewer.shl.url,
   *   recipient: 'Dr. Smith - General Practice',
   *   passcode: 'secret123', // if P flag is set
   *   embeddedLengthMax: 8192
   * });
   * console.log(`Manifest contains ${manifest.files.length} files`);
   * ```
   */
  async fetchManifest(params: {
    url: string
    recipient: string
    passcode?: string
    embeddedLengthMax?: number
  }): Promise<SHLManifestV1> {
    try {
      // Build manifest request per SHL spec
      const manifestRequest: SHLManifestRequestV1 = {
        recipient: params.recipient,
      }

      if (params.passcode) {
        manifestRequest.passcode = params.passcode
      }

      if (params.embeddedLengthMax !== undefined) {
        manifestRequest.embeddedLengthMax = params.embeddedLengthMax
      }

      // Make POST request to manifest URL per SHL spec
      const response = await this.fetchImpl(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(manifestRequest),
      })

      // Handle HTTP error responses
      if (!response.ok) {
        if (response.status === 401) {
          throw new SHLInvalidPasscodeError('Invalid or missing passcode')
        } else if (response.status === 404) {
          throw new SHLManifestNotFoundError('SHL manifest not found')
        } else if (response.status === 429) {
          throw new SHLManifestRateLimitError('Too many requests to SHL manifest')
        } else {
          throw new SHLNetworkError(
            `Failed to fetch SHL manifest, got HTTP ${response.status}: ${response.statusText}`
          )
        }
      }

      // Parse manifest response
      let manifest: SHLManifestV1
      try {
        const manifestJson = await response.text()
        manifest = JSON.parse(manifestJson) as SHLManifestV1
      } catch {
        throw new SHLManifestError('Invalid manifest response: not valid JSON')
      }

      // Validate manifest structure
      this.validateManifest(manifest)

      return manifest
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to fetch SHL manifest: ${errorMessage}`)
    }
  }

  /**
   * Validates a SHL manifest structure against the specification.
   *
   * Ensures the manifest has the required `files` array and that each
   * file descriptor has valid contentType and either embedded or location
   * (but not both). Validates content types and URL formats.
   *
   * @param manifest - Unknown manifest object to validate
   * @throws {@link SHLManifestError} When manifest structure is invalid
   *
   * @private
   */
  private validateManifest(manifest: unknown): asserts manifest is SHLManifestV1 {
    if (!manifest || typeof manifest !== 'object') {
      throw new SHLManifestError('Invalid manifest: must be an object')
    }

    const m = manifest as Record<string, unknown>

    if (!Array.isArray(m.files)) {
      throw new SHLManifestError('Invalid manifest: missing or invalid "files" array')
    }

    // Validate each file descriptor
    for (const [index, file] of m.files.entries()) {
      if (!file || typeof file !== 'object') {
        throw new SHLManifestError(`Invalid manifest: file[${index}] must be an object`)
      }

      const f = file as Record<string, unknown>

      if (!f.contentType || typeof f.contentType !== 'string') {
        throw new SHLManifestError(`Invalid manifest: file[${index}] missing "contentType"`)
      }

      // Validate content type
      const validContentTypes: SHLFileContentType[] = [
        'application/smart-health-card',
        'application/fhir+json',
      ]
      if (!validContentTypes.includes(f.contentType as SHLFileContentType)) {
        throw new SHLManifestError(`Invalid manifest: file[${index}] has unsupported content type`)
      }

      // Must have either embedded or location, but not both
      const hasEmbedded = typeof f.embedded === 'string'
      const hasLocation = typeof f.location === 'string'

      if (hasEmbedded && hasLocation) {
        throw new SHLManifestError(
          `Invalid manifest: file[${index}] cannot have both "embedded" and "location"`
        )
      }

      if (!hasEmbedded && !hasLocation) {
        throw new SHLManifestError(
          `Invalid manifest: file[${index}] must have either "embedded" or "location"`
        )
      }

      // Validate location URL if present
      if (hasLocation) {
        try {
          new URL(f.location as string)
        } catch {
          throw new SHLManifestError(
            `Invalid manifest: file[${index}] "location" is not a valid URL`
          )
        }
      }
    }
  }

  /**
   * Fetch and decrypt a file using the provided key.
   *
   * Downloads an encrypted file from a location URL and decrypts it
   * using the SHL's encryption key. Handles HTTP errors and decryption failures.
   *
   * @param params.url - HTTPS URL to the encrypted JWE file
   * @param params.key - Base64url-encoded encryption key from SHL
   * @param params.recipient - Recipient identifier for the request (required only when `U` flag is set)
   * @returns Promise resolving to decrypted file object with `content` and `contentType`
   * @throws {@link SHLViewerError} When recipient is not provided but `U` flag is set
   * @throws {@link SHLNetworkError} When file cannot be loaded
   * @throws {@link SHLDecryptionError} When JWE decryption fails
   *
   * @private
   */
  private async fetchAndDecryptFile(params: {
    url: string
    key: string
    recipient?: string
  }): Promise<{ content: string; contentType: string | undefined }> {
    try {
      let url = params.url

      // Set recipient if provided
      if (!params.recipient && this.shl.isDirectFile) {
        throw new SHLViewerError('Recipient is required when U flag is set')
      }
      if (params.recipient) {
        const urlObj = new URL(url)
        urlObj.searchParams.set('recipient', params.recipient)
        url = urlObj.toString()
      }

      // Fetch the encrypted file
      const response = await this.fetchImpl(url, {
        method: 'GET',
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new SHLNetworkError(`File not found at URL: ${params.url}`)
        } else {
          throw new SHLNetworkError(
            `Failed to fetch file from storage at ${params.url}, got HTTP ${response.status}: ${response.statusText}`
          )
        }
      }

      // Get JWE content
      const jwe = await response.text()

      // Decrypt the file
      const decrypted = await decryptSHLFile({
        jwe,
        key: params.key,
      })

      return decrypted
    } catch (error) {
      if (error instanceof SHLError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SHLNetworkError(`Failed to fetch and decrypt SHL file: ${errorMessage}`)
    }
  }

  /**
   * Fetch and decrypt all files from a SHL manifest.
   *
   * This method processes each file descriptor in the manifest, either decrypting
   * embedded files directly or fetching and decrypting location-based files.
   * It validates that the decrypted content type matches the manifest descriptor.
   *
   * @param manifest - SHL manifest containing file descriptors
   * @returns Promise resolving to array of decrypted file objects with `content` and `contentType`
   * @throws {@link SHLManifestError} When content type mismatch occurs
   * @throws {@link SHLNetworkError} When file fetching fails
   * @throws {@link SHLDecryptionError} When file decryption fails
   *
   * @example
   * ```typescript
   * const viewer = new SHLViewer({ shlinkURI: 'shlink:/...' });
   * const manifest = await viewer.fetchManifest({
   *   url: viewer.shl.url,
   *   recipient: 'Dr. Smith'
   * });
   * const decryptedFiles = await viewer.decryptFiles(manifest);
   * console.log(`Decrypted ${decryptedFiles.length} files`);
   * ```
   */
  async decryptFiles(
    manifest: SHLManifestV1
  ): Promise<Array<{ content: string; contentType: string | undefined }>> {
    const shl = this.shl
    const results = []
    for (const fileDescriptor of manifest.files) {
      let decryptedFile: { content: string; contentType: string | undefined }
      if ('embedded' in fileDescriptor) {
        decryptedFile = await decryptSHLFile({ jwe: fileDescriptor.embedded, key: shl.key })
      } else {
        decryptedFile = await this.fetchAndDecryptFile({
          url: fileDescriptor.location,
          key: shl.key,
        })
      }
      if (decryptedFile.contentType !== fileDescriptor.contentType) {
        throw new SHLManifestError(
          `Content type mismatch: expected ${fileDescriptor.contentType}, got ${decryptedFile.contentType}`
        )
      }
      results.push(decryptedFile)
    }
    return results
  }

  /**
   * Inspect the content of a parsed JSON to determine its type when contentType is undefined.
   *
   * This method analyzes the JSON structure to detect whether it's a
   * SMART Health Card (has verifiableCredential at root) or FHIR JSON (has resourceType).
   *
   * @param content - The parsed JSON
   * @returns The detected content type (application/smart-health-card or application/fhir+json)
   * @throws {@link SHLInvalidContentError} When content is not valid JSON
   *
   * @private
   */
  private inspectContentType(content: Record<string, unknown>): SHLFileContentType {
    try {
      // Check if it's a SMART Health Card (has verifiableCredential at root)
      if (content && typeof content === 'object' && Array.isArray(content.verifiableCredential)) {
        return 'application/smart-health-card'
      }

      // Check if it's a FHIR resource (has resourceType)
      if (content && typeof content === 'object' && typeof content.resourceType === 'string') {
        return 'application/fhir+json'
      }
    } catch {
      // Not valid JSON, can't determine type
    }
    throw new SHLInvalidContentError('Invalid content: not valid JSON')
  }

  /**
   * Parse decrypted files into structured SMART Health Cards and FHIR resources.
   *
   * This method processes the decrypted file content based on their content types,
   * creating SmartHealthCard objects from application/smart-health-card files
   * and parsing FHIR resources from application/fhir+json files.
   *
   * @param files - Array of decrypted files with metadata
   * @param shcReaderConfig - Optional configuration for SMART Health Card verification
   * @returns Promise resolving to structured content organized by type (`smartHealthCards`, `fhirResources`)
   * @throws {@link SHLInvalidContentError} When file content is not valid JSON or invalid SHC/FHIR resource
   *
   * @example
   * ```typescript
   * const viewer = new SHLViewer({ shlinkURI: 'shlink:/...' });
   * const manifest = await viewer.fetchManifest({ url: viewer.shl.url, recipient: 'Dr. Smith' });
   * const decryptedFiles = await viewer.decryptFiles(manifest);
   * const { smartHealthCards, fhirResources } = await viewer.parseDecrypted(
   *   decryptedFiles,
   *   { publicKey: myPublicKey }
   * );
   * console.log(`Found ${smartHealthCards.length} health cards and ${fhirResources.length} FHIR resources`);
   * ```
   */
  async parseDecrypted(
    files: Array<{
      content: string
      contentType: string | undefined
    }>,
    shcReaderConfig?: SmartHealthCardReaderConfigParams
  ): Promise<{ smartHealthCards: SmartHealthCard[]; fhirResources: Resource[] }> {
    const smartHealthCards: SmartHealthCard[] = []
    const fhirResources: Resource[] = []
    for (const file of files) {
      let parsedContent: Record<string, unknown>
      try {
        parsedContent = JSON.parse(file.content)
      } catch {
        throw new SHLInvalidContentError('Invalid JSON file: not valid JSON')
      }

      // Use inspectContentType when contentType is undefined
      const effectiveContentType = file.contentType ?? this.inspectContentType(parsedContent)

      if (effectiveContentType === 'application/smart-health-card') {
        let fileContent: { verifiableCredential: string[] }
        try {
          fileContent = parsedContent as { verifiableCredential: string[] }
        } catch {
          throw new SHLInvalidContentError('Invalid SMART Health Card file: not valid JSON')
        }
        if (!Array.isArray(fileContent.verifiableCredential)) {
          throw new SHLInvalidContentError(
            'Invalid SMART Health Card file: missing verifiableCredential array'
          )
        }
        const reader = new SmartHealthCardReader(shcReaderConfig ?? {})
        for (const jws of fileContent.verifiableCredential) {
          try {
            const shc = await reader.fromJWS(jws)
            smartHealthCards.push(shc)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new SHLInvalidContentError(`Invalid SMART Health Card file: ${message}`)
          }
        }
      } else if (effectiveContentType === 'application/fhir+json') {
        const fhirResource = parsedContent as unknown as Resource
        if (!fhirResource.resourceType) {
          throw new SHLInvalidContentError('Invalid FHIR JSON file: missing resourceType')
        }
        fhirResources.push(fhirResource)
      }
    }
    return { smartHealthCards, fhirResources }
  }
}
