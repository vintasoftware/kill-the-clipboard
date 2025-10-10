import type { Issuer } from './types'

export class Directory {
  constructor(private issuerInfo: Issuer[]) {}

  getIssuerInfo(): Issuer[] {
    return this.issuerInfo
  }

  static fromJSON(json: JSON): Directory {
    const data: Issuer[] = []
    return new Directory(data)
  }

  static async fromURLs(issUrls: string[]): Promise<Directory> {
    const issuersInfo: Issuer[] = []

    try {
      for (const issUrl of issUrls) {
        const issuer: Issuer = {
          iss: issUrl,
          keys: [],
          crls: [],
        }

        const crls = []
        const jwksUrl = `${issUrl}/.well-known/jwks.json`
        const jwksResponse = await fetch(jwksUrl)
        if (!jwksResponse.ok) {
          const errorData = await jwksResponse.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `Failed to fetch jwks at ${jwksUrl}`)
        }

        const { keys: issKeys } = await jwksResponse.json()
        for (const key of issKeys) {
          const crlUrl = `${issUrl}/.well-known/crl/${key.kid}.json`
          const crlResponse = await fetch(crlUrl)
          if (!crlResponse.ok) {
            const errorData = await crlResponse.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(errorData.error || `Failed to fetch crl at ${crlUrl}`)
          }
          const crl = await crlResponse.json()
          if (crl) crls.push(crl)
        }

        issuer.keys = issKeys.keys
        issuer.crls = crls
        issuersInfo.push(issuer)
      }
    } catch (error) {
      console.error('Error creating Directory:', error)
    }

    return new Directory(issuersInfo)
  }
}
