import { v4 as uuidv4 } from 'uuid';
import { MedplumClient } from '@medplum/core';

// Shared Medplum file handling functions for SHL operations.
// These functions handle file upload, URL generation, and file loading
// using Medplum's Binary resource system.

/**
 * Upload encrypted file content to Medplum as a Binary resource.
 * @param medplum - Authenticated Medplum client instance
 * @param content - The encrypted file content (JWE string)
 * @param contentType - Optional content type (defaults to 'application/jose')
 * @returns Promise resolving to the Binary resource ID
 */
export async function uploadSHLFile(
  medplum: MedplumClient,
  content: string,
  contentType?: string
): Promise<string> {
  console.log('uploadSHLFile called with content length:', content.length);

  try {
    // Upload encrypted file content to Medplum as Binary resource
    // Use createBinary method which handles file data properly
    const binary = await medplum.createBinary({
      data: content, // JWE content as string
      filename: `shl-file-${uuidv4()}.jwe`,
      contentType: contentType || 'application/jose', // JWE content type
    });

    console.log('At uploadSHLFile, Binary resource created:', binary.id);
    return `Binary/${binary.id}`; // Return the Binary FHIR path
  } catch (error) {
    console.error('Error uploading file to Medplum:', error);
    throw error;
  }
}

/**
 * Return the proxied URL for the Binary resource to bypass CORS issues.
 * `path` param is already a full presigned S3 URL processed by Medplum, but we need to proxy it
 * to bypass CORS issues on the client side (Medplum's S3 uses strict-origin-when-cross-origin).
 * See `getBuilderAttrsAndSHL` in medplum-storage.ts for more details.
 * @param path - The presigned URL from Medplum storage
 * @returns The proxy URL that routes through our API to fetch the file
 */
export async function getSHLFileURL(path: string): Promise<string> {
  // Construct proxy URL that will fetch the presigned URL server-side
  const proxyUrl = new URL(`${process.env.SHL_SERVER_BASE_URL!}/files/proxy`);
  proxyUrl.searchParams.set('url', path);

  return Promise.resolve(proxyUrl.toString());
}

/**
 * Create file handling functions for manifest serving (uploadFile throws error).
 * @param medplum - Authenticated Medplum client instance
 * @returns Object with uploadFile (throws error if readonly), getFileURL, and loadFile functions
 */
export function buildManifestFileHandlers(medplum: MedplumClient, readonly: boolean = false) {
  return {
    uploadFile: async (content: string, contentType?: string) => {
      if (readonly) {
        // This shouldn't be called during manifest building from stored state
        throw new Error('Upload not supported during manifest serving');
      } else {
        return uploadSHLFile(medplum, content, contentType);
      }
    },
    getFileURL: getSHLFileURL,
  };
}
