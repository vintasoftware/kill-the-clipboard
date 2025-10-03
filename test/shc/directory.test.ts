import { describe, it } from 'vitest'
import { Directory } from '../../src/shc/directory'

describe('Directory', () => {
  it('Should create a directory from a list of issuers urls', async () => {
    const directory = await Directory.fromURLs([
      'https://raw.githubusercontent.com/seanno/shc-demo-data/main',
    ])
  })
})
