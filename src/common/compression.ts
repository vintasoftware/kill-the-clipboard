// Shared Compression Utilities
// Used by both SHC and SHL implementations

/**
 * Raw DEFLATE compression helper - matches older jose 4.x.x deflateRaw implementation (when it supported compression).
 * Uses Node.js zlib.deflateRaw in Node.js environments and pako in browsers.
 *
 * @group Utils
 */
export async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Check if we're in Node.js environment
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    // Node.js environment - use zlib.deflateRaw (same as older jose)
    const { promisify } = await import('util')
    const { deflateRaw } = await import('zlib')
    const deflateRawAsync = promisify(deflateRaw)
    const compressed = await deflateRawAsync(data)
    return new Uint8Array(compressed)
  } else {
    // Browser environment - use pako for compatibility
    const pako = await import('pako')
    const compressed = pako.deflateRaw(data)
    return new Uint8Array(compressed)
  }
}

/**
 * Raw DEFLATE decompression helper - matches older jose 4.x.x inflateRaw implementation (when it supported compression).
 * Uses Node.js zlib.inflateRaw in Node.js environments and pako in browsers.
 *
 * @group Utils
 */
export async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Check if we're in Node.js environment
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    // Node.js environment - use zlib.inflateRaw (same as older jose)
    const { promisify } = await import('util')
    const { inflateRaw } = await import('zlib')
    const inflateRawAsync = promisify(inflateRaw)
    const decompressed = await inflateRawAsync(data)
    return new Uint8Array(decompressed)
  } else {
    // Browser environment - use pako for compatibility
    const pako = await import('pako')
    const decompressed = pako.inflateRaw(data)
    return new Uint8Array(decompressed)
  }
}
