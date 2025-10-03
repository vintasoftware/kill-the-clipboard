interface IssuerInterface {
  iss: string
  keys: []
  crls: any[]
}

interface DirectoryInterface {
  fhirBundle: {}
  issuerInfo: IssuerInterface[]
}

export class Directory {
  constructor(private directory: DirectoryInterface) {}

  getDirectory(): DirectoryInterface {
    return this.directory
  }

  static fromJSON(json: JSON): Directory {
    const data = {}
    return new Directory(data as DirectoryInterface)
  }

  static async fromURLs(issUrls: string[]): Promise<Directory> {
    const data: DirectoryInterface = {
      fhirBundle: {},
      issuerInfo: [],
    }

    for (const issUrl of issUrls) {
      const issuer: IssuerInterface = {
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
      data.issuerInfo.push(issuer)
    }

    return new Directory(data as DirectoryInterface)
  }
}
