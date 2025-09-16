import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

let r2Client: S3Client | null = null;

/**
 * Initialize R2 client
 */
function getR2Client(): S3Client {
  if (!r2Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 configuration. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
    }

    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return r2Client;
}

/**
 * Read SHL file content from R2 (used by the file serving route)
 * @param fileId The file identifier
 * @returns Promise<string> The file content
 */
export async function readSHLFile(fileId: string): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set');
  }

  const client = getR2Client();
  const fileName = `${fileId}.jwe`;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileName,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error(`File not found: ${fileId}`);
    }

    // Convert the response body to string
    const body = await response.Body.transformToString();
    return body;
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      throw new Error(`File not found: ${fileId}`);
    }
    throw error;
  }
}

/**
 * Upload SHL file content to R2
 * @param content The content to store
 * @param _contentType Optional content type (unused but kept for compatibility)
 * @returns Promise<string> The file path/identifier
 */
export async function uploadSHLFile(
  content: string,
  _contentType?: string
): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set');
  }

  const client = getR2Client();

  // Generate a unique filename using crypto
  const fileId = crypto.randomBytes(16).toString('hex');
  const fileName = `${fileId}.jwe`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: content,
    ContentType: 'application/jose',
    // Set cache headers for security
    CacheControl: 'private, no-cache, no-store, must-revalidate',
  });

  await client.send(command);

  // Return the file ID (which can be used to retrieve the file later)
  return fileId;
}

/**
 * Get SHL file URL (returns a presigned URL that expires in 1 hour)
 * @param fileId The file identifier
 * @returns Promise<string> The presigned URL to retrieve the file directly from R2
 */
export async function getSHLFileURL(fileId: string): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set');
  }

  const client = getR2Client();
  const fileName = `${fileId}.jwe`;

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: fileName,
  });

  // Generate presigned URL that expires in 1 hour (3600 seconds)
  const presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });

  return presignedUrl;
}

/**
 * Create manifest file handlers for R2 storage
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
