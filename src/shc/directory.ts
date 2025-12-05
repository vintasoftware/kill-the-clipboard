import type { DirectoryJSON, Issuer, IssuerCrl, IssuerKey } from './types'

/**
 * Directory is a lightweight representation of issuer metadata used by
 * SMART Health Cards code paths. It contains a collection of issuer info
 * objects including the issuer identifier, known JWK keys and optionally
 * Certificate Revocation Lists (CRLs).
 *
 * @public
 * @group SHC
 * @category Lower-Level API
 */
export class Directory {
  /**
   * Create a new Directory instance from a list of issuer info objects.
   *
   * @param issuerInfo - Array of issuer entries (see {@link Issuer})
   */
  constructor(private issuerInfo: Issuer[]) {}

  /**
   * Return the internal issuer info array.
   *
   * @returns Array of issuer info objects
   */
  getIssuerInfo(): Issuer[] {
    return this.issuerInfo
  }

  /**
   * Fetch a snapshot of the VCI Directory published by The Commons Project
   * and build a {@link Directory} from it.
   *
   * This helper fetches a well-known VCI snapshot JSON file and delegates to
   * `Directory.fromJSON` to produce a `Directory` instance. If the snapshot
   * cannot be retrieved (non-2xx response) the function throws an Error.
   *
   * @returns A {@link Directory} populated from the VCI snapshot
   * @throws Error when the VCI snapshot HTTP fetch returns a non-OK status
   * @example
   * const directory = await Directory.fromVCI()
   */
  static async fromVCI(): Promise<Directory> {
    const vciSnapshotResponse = await fetch(
      'https://raw.githubusercontent.com/the-commons-project/vci-directory/main/logs/vci_snapshot.json'
    )
    if (!vciSnapshotResponse.ok) {
      throw new Error(
        `Failed to fetch VCI Directory snapshot with status ${vciSnapshotResponse.status}`
      )
    }
    const vciDirectoryJson = await vciSnapshotResponse.json()
    return Directory.fromJSON(vciDirectoryJson)
  }

  /**
   * Build a Directory from a parsed JSON object matching the published
   * directory schema.
   *
   * This method is defensive: if `issuer.iss` is missing or not a string it
   * will be coerced to an empty string; if `keys` or `crls` are not arrays
   * they will be treated as empty arrays.
   *
   * @param directoryJson - The JSON object to convert into a Directory
   * @returns A new {@link Directory} instance
   * @example
   * const directory = Directory.fromJSON(parsedJson)
   */
  static fromJSON(directoryJson: DirectoryJSON): Directory {
    const data: Issuer[] = directoryJson.issuerInfo.map(({ issuer, keys, crls }) => {
      const iss = typeof issuer?.iss === 'string' ? issuer.iss : ''
      const validKeys = Array.isArray(keys) ? keys : []
      const validCrls = Array.isArray(crls) ? crls : []
      return {
        iss,
        keys: validKeys,
        crls: validCrls,
      }
    })
    return new Directory(data)
  }

  /**
   * Create a Directory by fetching issuer metadata (JWKS) and CRLs from the
   * provided issuer base URLs.
   *
   * For each issuer URL the method attempts to fetch `/.well-known/jwks.json`
   * and will then attempt to fetch CRLs for each key at
   * `/.well-known/crl/{kid}.json`. Failures to fetch a JWKS will skip that
   * issuer; failures to fetch a CRL for an individual key will skip that key's
   * CRL but keep the key. Errors are logged via `console.debug` and
   * unexpected exceptions are caught and logged with `console.error`.
   *
   * @param issUrls - Array of issuer base URLs to fetch (e.g. `https://example.com/issuer`)
   * @returns A {@link Directory} containing any successfully fetched issuer info
   * @example
   * const directory = await Directory.fromURLs(['https://example.com/issuer'])
   */
  static async fromURLs(issUrls: string[]): Promise<Directory> {
    const directoryJson: DirectoryJSON = {
      issuerInfo: [],
    }

    try {
      for (const issUrl of issUrls) {
        const issuerInfo = {
          issuer: {
            iss: issUrl,
          },
          keys: [] as IssuerKey[],
          crls: [] as IssuerCrl[],
        }

        const jwksUrl = `${issUrl}/.well-known/jwks.json`
        const jwksResponse = await fetch(jwksUrl)
        if (!jwksResponse.ok) {
          const errorMessage = `Failed to fetch jwks at ${jwksUrl} with status ${jwksResponse.status}, skipping issuer.`
          console.debug(errorMessage)
          continue
        }

        const { keys: issKeys } = await jwksResponse.json()
        for (const key of issKeys) {
          issuerInfo.keys.push(key)
          const crlUrl = `${issUrl}/.well-known/crl/${key.kid}.json`
          const crlResponse = await fetch(crlUrl)
          if (!crlResponse.ok) {
            const errorMessage = `Failed to fetch crl at ${crlUrl} with status ${crlResponse.status}, skipping key.`
            console.debug(errorMessage)
            continue
          }
          const crl = await crlResponse.json()
          if (crl) issuerInfo.crls.push(crl)
        }

        directoryJson.issuerInfo.push(issuerInfo)
      }
    } catch (error) {
      console.error('Error creating Directory:', error)
    }

    return Directory.fromJSON(directoryJson)
  }
}
