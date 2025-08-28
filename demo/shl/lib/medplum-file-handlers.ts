import { MedplumClient } from '@medplum/core';

/**
 * Shared Medplum file handling functions for SHL operations.
 * These functions handle file upload, URL generation, and file loading
 * using Medplum's Binary resource system.
 */

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
  console.log('uploadSHLFile called with content length:', content.length, 'contentType:', contentType);

  try {
    // Upload encrypted file content to Medplum as Binary resource
    // Use createBinary method which handles file data properly
    const binary = await medplum.createBinary({
      data: content, // JWE content as string
      filename: `shl-file-${Date.now()}.jwe`,
      contentType: contentType || 'application/jose', // JWE content type
    });

    console.log('Binary resource created:', binary.id, 'URL:', binary.url);
    return binary.id!; // Return the Binary resource ID as storage path
  } catch (error) {
    console.error('Error uploading file to Medplum:', error);
    throw error;
  }
}

/**
 * Generate a URL for a Binary resource using Medplum's fhirUrl method.
 * @param medplum - Authenticated Medplum client instance
 * @param binaryID - The Binary resource ID
 * @returns The FHIR URL for the Binary resource
 */
export async function getSHLFileURL(medplum: MedplumClient, binaryID: string): Promise<string> {
  console.log('getSHLFileURL called for binaryID:', binaryID);
  const url = medplum.fhirUrl('Binary', binaryID).toString();
  console.log('Generated FHIR URL:', url);
  return Promise.resolve(url);
  // const binary = await medplum.readResource('Binary', binaryID);
  // const url = binary.url!;
  // console.log('Generated FHIR URL:', url);
  // return url;
}

/**
 * Load file content from a Medplum Binary resource.
 * @param medplum - Authenticated Medplum client instance
 * @param path - The Binary resource ID
 * @returns Promise resolving to the file content as a string
 */
export async function loadSHLFile(medplum: MedplumClient, path: string): Promise<string> {
  console.log('loadSHLFile called for path:', path);

  try {
    const blob = await medplum.download(`Binary/${path}`);
    const content = await blob.text();
    console.log('File content loaded (first 50 bytes):', content.slice(0, 50));
    return content;
  } catch (error) {
    console.error('Error loading file from Medplum:', error);
    throw error;
  }
}

/**
 * Create file handling functions for manifest serving (uploadFile throws error).
 * @param medplum - Authenticated Medplum client instance
 * @returns Object with uploadFile (throws error if readonly), getFileURL, and loadFile functions
 */
export function createManifestFileHandlers(medplum: MedplumClient, readonly: boolean = false) {
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
    loadFile: async (path: string) => {
      return loadSHLFile(medplum, path);
    },
  };
}
