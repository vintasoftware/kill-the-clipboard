import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Directory to store SHL files
const SHL_FILES_DIR = path.join(process.cwd(), 'shl-files');

/**
 * Read SHL file content from filesystem (used by the file serving route)
 * @param fileId The file identifier
 * @returns Promise<string> The file content
 */
export async function readSHLFile(fileId: string): Promise<string> {
  const fileName = `${fileId}.jwe`;
  const filePath = path.join(SHL_FILES_DIR, fileName);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${fileId}`);
    }
    throw error;
  }
}

// Ensure the SHL files directory exists
async function ensureDirectoryExists(): Promise<void> {
  try {
    await fs.mkdir(SHL_FILES_DIR, { recursive: true });
  } catch (error) {
    // Ignore error if directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Upload SHL file content to filesystem
 * @param content The content to store
 * @param contentType Optional content type (unused but kept for compatibility)
 * @returns Promise<string> The file path/identifier
 */
export async function uploadSHLFile(
  content: string,
  _contentType?: string
): Promise<string> {
  await ensureDirectoryExists();

  // Generate a unique filename using crypto
  const fileId = crypto.randomBytes(16).toString('hex');
  const fileName = `${fileId}.jwe`;
  const filePath = path.join(SHL_FILES_DIR, fileName);

  // Write content to file
  await fs.writeFile(filePath, content, 'utf8');

  // Return the file ID (which can be used to retrieve the file later)
  return fileId;
}

/**
 * Get SHL file URL (returns a full URL to the file endpoint)
 * @param fileId The file identifier
 * @returns Promise<string> The full URL to retrieve the file
 */
export async function getSHLFileURL(fileId: string): Promise<string> {
  if (!process.env.SHL_SERVER_BASE_URL) {
    throw new Error('SHL_SERVER_BASE_URL is not set');
  }

  // Return a full URL to the file endpoint
  return `${process.env.SHL_SERVER_BASE_URL}/files/${fileId}`;
}

/**
 * Create manifest file handlers for filesystem storage
 * @param readonly Whether the handlers should be read-only
 * @returns Object with uploadFile and getFileURL functions
 */
export function createManifestFileHandlers(readonly: boolean = false) {
  return {
    uploadFile: readonly ?
      async (): Promise<string> => { throw new Error('Upload not allowed in read-only mode'); } :
      uploadSHLFile,
    getFileURL: getSHLFileURL,
  };
}
