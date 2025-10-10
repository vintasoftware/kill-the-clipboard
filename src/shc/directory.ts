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
    const data: Issuer[] = []

    for (const issUrl of issUrls) {
      const issuer: Issuer = {
        iss: issUrl,
        keys: [],
        crls: [],
      }

      const crls = []
      const keysUrl = `${issUrl}/.well-known/jwks.json`

      const response = await fetch(keysUrl)
      if (!response.ok) continue

      const issKeys = await response.json()

      for (const key of issKeys.keys) {
        const crlUrl = `${issUrl}/.well-known/crl/${key.kid}.json`

        const response = await fetch(crlUrl)
        if (!response.ok) continue

        const crl = await response.json()
        if (crl) crls.push(crl)
      }

      issuer.keys = issKeys.keys
      issuer.crls = crls
      data.push(issuer)
    }

    return new Directory(data)
  }
}
