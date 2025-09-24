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
 * Generate a URL for a Binary resource using Medplum's fhirUrl method.
 * @param medplum - Authenticated Medplum client instance
 * @param path - The Binary path
 * @returns The FHIR URL for the Binary resource
 */
export async function getSHLFileURL(medplum: MedplumClient, path: string): Promise<string> {
  console.log('getSHLFileURL called for path:', path);
  const url = medplum.fhirUrl(path).toString();
  console.log('getSHLFileURL generated FHIR URL:', url);
  return Promise.resolve(url);
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
    getFileURL: async (path: string) => {
      return getSHLFileURL(medplum, path);
    },
  };
}
