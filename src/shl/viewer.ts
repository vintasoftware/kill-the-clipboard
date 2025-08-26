import type { Resource } from '@medplum/fhirtypes'
import { base64url } from 'jose'
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
} from './errors.js'
import { SHL } from './shl.js'
import type {
  SHLFileContentType,
  SHLinkPayloadV1,
  SHLManifestRequestV1,
  SHLManifestV1,
  SHLResolvedContent,
} from './types.js'

// Import types to avoid circular imports
type SmartHealthCard = unknown
type SmartHealthCardReader = unknown & {
  fromJWS(jws: string): Promise<SmartHealthCard>
}

/**
 * SHL Viewer handles parsing and resolving Smart Health Links.
 * This class processes SHLink URIs and fetches/decrypts the referenced content.
 *
 * @public
 * @category SHL High-Level API
 */
export class SHLViewer {
  private readonly _shl?: SHL
  private readonly fetchImpl: (url: string, options?: RequestInit) => Promise<Response>

  /**
   * Create an SHL viewer.
   *
   * @param params.shlinkURI - The SHLink URI to parse
   * @param params.fetch - Optional fetch implementation (defaults to global fetch)
   */
  constructor(params?: {
    shlinkURI?: string
    fetch?: (url: string, options?: RequestInit) => Promise<Response>
  }) {
    this.fetchImpl = params?.fetch ?? fetch

    if (params?.shlinkURI) {
      this._shl = this.parseSHLinkURI(params.shlinkURI)
    }
  }

  /**
   * Get SHLink object from SHLink URI
   */
  get shl(): SHL {
    if (!this._shl) {
      throw new SHLFormatError('No SHLink URI provided to viewer')
    }
    return this._shl
  }

  /**
   * Resolve a SHLink URI by fetching and decrypting all referenced content.
   * Throws errors if the SHLink is invalid, expired, or the passcode is incorrect.
   *
   * @param params.passcode - Optional passcode for P-flagged SHLinks
   * @param params.recipient - Required recipient identifier for manifest requests
   * @param params.embeddedLengthMax - Optional max length for embedded content preference
   */
  async resolveSHLink(params: {
    passcode?: string
    recipient: string
    embeddedLengthMax?: number
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
          // Import SmartHealthCardReader dynamically to avoid circular imports
          const { SmartHealthCardReader } = require('../shc/reader.js') as {
            SmartHealthCardReader: new (params: {
              verifyExpiration: boolean
            }) => SmartHealthCardReader
          }

          // Use SmartHealthCardReader to properly decode the JWS and extract the FHIR Bundle
          const reader = new SmartHealthCardReader({ verifyExpiration: false })
          const smartHealthCard = await reader.fromJWS(jws)
          smartHealthCards.push(smartHealthCard)
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
   * Parse a SHLink URI into an SHL object
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

      // Extract base URL from the manifest URL
      const manifestURL = new URL(payload.url)
      // For SHL, the base URL is typically just the origin
      // e.g., https://shl.example.org/manifests/abc123/manifest.json -> https://shl.example.org
      const baseURL = manifestURL.origin

      // Create a reconstructed SHL object using the static factory method
      return SHL.fromPayload(payload, baseURL, manifestURL.pathname)
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
   * Handles passcode challenges automatically if passcode is provided.
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
   * Validates a SHL manifest structure
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
