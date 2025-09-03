// Shared Compression Utilities
// Used by both SHC and SHL implementations

/**
 * Raw DEFLATE compression helper for both SHC and SHL implementations.
 * Uses browser/Node.js native CompressionStream.
 *
 * @group Utils
 */
export async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const compressedStream = readable.pipeThrough(new CompressionStream('deflate-raw'))
  const compressedBuffer = await new Response(compressedStream).arrayBuffer()
  return new Uint8Array(compressedBuffer)
}

/**
 * Raw DEFLATE decompression helper for both SHC and SHL implementations.
 * Uses browser/Node.js native DecompressionStream.
 *
 * @group Utils
 */
export async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const decompressedStream = readable.pipeThrough(new DecompressionStream('deflate-raw'))
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer()
  return new Uint8Array(decompressedBuffer)
}
