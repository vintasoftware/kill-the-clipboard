import { createManifestFileHandlers as createFilesystemHandlers, readSHLFile as readFilesystemFile } from './filesystem-file-handlers';
import { createManifestFileHandlers as createR2Handlers, readSHLFile as readR2File } from './r2-file-handlers';

/**
 * Determine if we're running in production environment
 * This is based on NODE_ENV and the presence of R2 configuration
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' &&
         !!process.env.R2_ACCOUNT_ID &&
         !!process.env.R2_ACCESS_KEY_ID &&
         !!process.env.R2_SECRET_ACCESS_KEY &&
         !!process.env.R2_BUCKET_NAME;
}

/**
 * Create appropriate file handlers based on environment
 * - Use filesystem storage in development/localhost
 * - Use R2 storage in production when R2 is properly configured
 * @param readonly Whether the handlers should be read-only
 * @returns Object with uploadFile and getFileURL functions
 */
export function createManifestFileHandlers(readonly: boolean = false) {
  if (isProduction()) {
    console.log('Using R2 storage for SHL files');
    return createR2Handlers(readonly);
  } else {
    console.log('Using filesystem storage for SHL files');
    return createFilesystemHandlers(readonly);
  }
}

/**
 * Read SHL file content using the appropriate storage backend
 * @param fileId The file identifier
 * @returns Promise<string> The file content
 */
export async function readSHLFile(fileId: string): Promise<string> {
  if (isProduction()) {
    throw new Error('Read operation not available in production');
  } else {
    return readFilesystemFile(fileId);
  }
}
