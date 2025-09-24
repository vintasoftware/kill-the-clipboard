import { NextRequest } from 'next/server';

/**
 * Proxy route to serve files from Medplum's S3 presigned URLs.
 * This bypasses CORS issues by proxying the request through our server.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const presignedUrl = searchParams.get('url');

    if (!presignedUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // Validate the presigned URL format for security
    if (!isValidMedplumStorageUrl(presignedUrl)) {
      return new Response('Invalid URL format', { status: 400 });
    }

    console.log('Proxying file request to:', presignedUrl);

    // Fetch the file from Medplum storage
    const response = await fetch(presignedUrl);

    if (!response.ok) {
      console.error('Failed to fetch file from Medplum:', response.status, response.statusText);
      return new Response('Failed to fetch file', { status: response.status });
    }

    // Stream the file content back to the client
    const headers = new Headers();

    // Copy relevant headers from the original response
    if (response.headers.get('content-type')) {
      headers.set('content-type', response.headers.get('content-type')!);
    }
    if (response.headers.get('content-length')) {
      headers.set('content-length', response.headers.get('content-length')!);
    }

    // Add CORS headers to allow frontend access
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET');
    headers.set('access-control-allow-headers', 'content-type');

    return new Response(response.body, {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Error in file proxy:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Validate that the URL matches the expected Medplum storage format for security.
 * Expected format: https://storage.medplum.com/binary/{uuid}/{uuid}?Expires=...&Key-Pair-Id=...&Signature=...
 */
function isValidMedplumStorageUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Check hostname
    if (parsedUrl.hostname !== 'storage.medplum.com') {
      console.warn('Invalid hostname:', parsedUrl.hostname);
      return false;
    }

    // Check path format: /binary/{uuid}/{uuid}
    const pathRegex = /^\/binary\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!pathRegex.test(parsedUrl.pathname)) {
      console.warn('Invalid path format:', parsedUrl.pathname);
      return false;
    }

    // Check required query parameters
    const requiredParams = ['Expires', 'Key-Pair-Id', 'Signature'];
    for (const param of requiredParams) {
      const value = parsedUrl.searchParams.get(param);
      if (!value || value.trim() === '') {
        console.warn(`Missing or empty required parameter: ${param}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.warn('Invalid URL format:', error);
    return false;
  }
}
