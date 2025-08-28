import type { Resource } from '@medplum/fhirtypes'
import { base64url } from 'jose'
import type { SmartHealthCard } from '../shc/card.js'
import { SmartHealthCardReader } from '../shc/reader.js'
import type { SmartHealthCardReaderConfigParams } from '../shc/types.js'
import { decryptSHLFile } from './crypto.js'
import {
  SHLError,
  SHLExpiredError,
  SHLFormatError,
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
  SHLinkPayloadV1,
  SHLManifestRequestV1,
  SHLManifestV1,
  SHLResolvedContent,
} from './types.js'

/**
 * SHL Viewer handles parsing and resolving Smart Health Links.
 *
 * This class processes SHLink URIs and fetches/decrypts the referenced content.
 * It supports both embedded and location-based file descriptors, handles
 * passcode authentication, and validates manifest structures according to
 * the Smart Health Links specification.
 *
 * The viewer automatically handles:
 * - SHLink URI parsing and payload validation
 * - Manifest fetching with POST requests
 * - File decryption using JWE with A256GCM
 * - Content decompression when zip=DEF is used
 * - Smart Health Card and FHIR resource extraction
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
 * @category High-Level API
 */
export class SHLViewer {
  private readonly _shl?: SHL
  private readonly fetchImpl: (url: string, options?: RequestInit) => Promise<Response>

  /**
   * Create an SHL viewer.
   *
   * The viewer can be created with or without an initial SHLink URI.
   * If no URI is provided, you can parse one later using the shl getter
   * after creating a viewer with a URI.
   *
   * @param params.shlinkURI - Optional SHLink URI to parse immediately.
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
   *
   * // Create empty viewer
   * const viewer = new SHLViewer();
   * ```
   */
  constructor(params?: {
    shlinkURI?: string
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

    if (params?.shlinkURI) {
      this._shl = this.parseSHLinkURI(params.shlinkURI)
    }
  }

  /**
   * Get the parsed SHL object from the SHLink URI.
   *
   * Returns the SHL instance created from parsing the SHLink URI provided
   * in the constructor. Use this to access SHL properties like expiration,
   * flags, and manifest URL.
   *
   * @returns SHL instance with parsed payload data
   * @throws {@link SHLFormatError} When no SHLink URI was provided to the constructor
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
    if (!this._shl) {
      throw new SHLFormatError('No SHLink URI provided to viewer')
    }
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
   * 5. Parses content based on type (Smart Health Cards or FHIR resources)
   * 6. Returns structured data ready for application use
   *
   * @param params.recipient - Required recipient identifier sent in manifest request.
   *   This should identify the requesting user/system (e.g., "Dr. Smith", "Patient Portal")
   * @param params.passcode - Optional passcode for P-flagged SHLinks.
   *   Required when SHL has 'P' flag, ignored otherwise.
   * @param params.embeddedLengthMax - Optional preference for embedded vs location files.
   *   Files smaller than this size (in bytes) will be embedded in manifest response.
   *   Defaults to server's preference if not specified. Typical values: 4096-16384.
   *
   * @returns Promise resolving to structured content with manifest and decrypted files
   * @throws {@link SHLExpiredError} When SHL has expired (exp field < current time)
   * @throws {@link SHLInvalidPasscodeError} When P-flagged SHL requires passcode but none provided, or passcode is incorrect
   * @throws {@link SHLManifestNotFoundError} When manifest URL returns 404
   * @throws {@link SHLManifestRateLimitError} When requests are rate limited (429)
   * @throws {@link SHLNetworkError} When network requests fail
   * @throws {@link SHLDecryptionError} When file decryption fails
   * @throws {@link SHLManifestError} When manifest structure is invalid or file content is malformed
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
   *   // Process Smart Health Cards
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

    // Check expiration
    if (shl.exp && shl.exp < Math.floor(Date.now() / 1000)) {
      throw new SHLExpiredError('SHL has expired')
    }

    // Validate passcode requirement
    if (shl.requiresPasscode && !params.passcode) {
      throw new SHLInvalidPasscodeError('SHL requires a passcode')
    }

    // Fetch manifest
    const manifest = await this.fetchManifest({
      url: shl.url,
      recipient: params.recipient,
      ...(params.passcode && { passcode: params.passcode }),
      ...(params.embeddedLengthMax !== undefined && {
        embeddedLengthMax: params.embeddedLengthMax,
      }),
    })

    // Process all files in the manifest
    const smartHealthCards: SmartHealthCard[] = []
    const fhirResources: Resource[] = []

    for (const fileDescriptor of manifest.files) {
      let decryptedFile: { content: string; contentType: string }

      if ('embedded' in fileDescriptor) {
        // Decrypt embedded file
        decryptedFile = await decryptSHLFile({
          jwe: fileDescriptor.embedded,
          key: shl.key,
        })
      } else {
        // Fetch and decrypt external file
        decryptedFile = await this.fetchAndDecryptFile({
          url: fileDescriptor.location,
          key: shl.key,
        })
      }

      // Verify content type matches
      if (decryptedFile.contentType !== fileDescriptor.contentType) {
        throw new SHLManifestError(
          `Content type mismatch: expected ${fileDescriptor.contentType}, got ${decryptedFile.contentType}`
        )
      }

      // Process based on content type
      if (fileDescriptor.contentType === 'application/smart-health-card') {
        // Parse SMART Health Card file
        let fileContent: { verifiableCredential: string[] }
        try {
          fileContent = JSON.parse(decryptedFile.content) as { verifiableCredential: string[] }
        } catch {
          throw new SHLManifestError('Invalid SMART Health Card file: not valid JSON')
        }

        if (!Array.isArray(fileContent.verifiableCredential)) {
          throw new SHLManifestError(
            'Invalid SMART Health Card file: missing verifiableCredential array'
          )
        }

        // Create SmartHealthCard objects for each JWS
        for (const jws of fileContent.verifiableCredential) {
          // Use SmartHealthCardReader to properly decode the JWS and extract the FHIR Bundle
          const reader = new SmartHealthCardReader(params.shcReaderConfig ?? {})
          try {
            const smartHealthCard = await reader.fromJWS(jws)
            smartHealthCards.push(smartHealthCard)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new SHLManifestError(`Invalid SMART Health Card file: ${message}`)
          }
        }
      } else if (fileDescriptor.contentType === 'application/fhir+json') {
        // Parse FHIR resource
        let fhirResource: Resource
        try {
          fhirResource = JSON.parse(decryptedFile.content) as Resource
        } catch {
          throw new SHLManifestError('Invalid FHIR JSON file: not valid JSON')
        }

        if (!fhirResource.resourceType) {
          throw new SHLManifestError('Invalid FHIR JSON file: missing resourceType')
        }

        fhirResources.push(fhirResource)
      }
    }

    return {
      manifest,
      smartHealthCards,
      fhirResources,
    }
  }

  /**
   * Parse a SHLink URI into an SHL object.
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
   *
   * @private
   */
  private parseSHLinkURI(shlinkURI: string): SHL {
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
   * @returns Promise resolving to validated manifest object
   * @throws {@link SHLInvalidPasscodeError} When server returns 401 (invalid/missing passcode)
   * @throws {@link SHLManifestNotFoundError} When server returns 404 (manifest not found)
   * @throws {@link SHLManifestRateLimitError} When server returns 429 (rate limited)
   * @throws {@link SHLNetworkError} When other HTTP errors occur or network fails
   * @throws {@link SHLManifestError} When manifest response is not valid JSON or has invalid structure
   *
   * @private
   */
  private async fetchManifest(params: {
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
          throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
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
   * @returns Promise resolving to decrypted file content and content type
   * @throws {@link SHLManifestNotFoundError} When file URL returns 404
   * @throws {@link SHLManifestRateLimitError} When file requests are rate limited (429)
   * @throws {@link SHLNetworkError} When other HTTP errors occur or network fails
   * @throws {@link SHLDecryptionError} When JWE decryption fails
   *
   * @private
   */
  private async fetchAndDecryptFile(params: {
    url: string
    key: string
  }): Promise<{ content: string; contentType: string }> {
    try {
      // Fetch the encrypted file
      const response = await this.fetchImpl(params.url, {
        method: 'GET',
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new SHLManifestNotFoundError('SHL file not found')
        } else if (response.status === 429) {
          throw new SHLManifestRateLimitError('Too many requests to SHL file')
        } else {
          throw new SHLNetworkError(`HTTP ${response.status}: ${response.statusText}`)
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
}
