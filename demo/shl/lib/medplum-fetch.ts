import { MedplumClient } from "@medplum/core";

/**
 * Medplum-authenticated fetch for server-side operations.
 */
export function buildMedplumFetch(medplum: MedplumClient) {
  const accessToken = medplum.getAccessToken();

  return async (url: string, options?: RequestInit | undefined) => {
    options = options || {};
    options.headers = (options.headers || {}) as Record<string, string>;
    options.headers.Authorization = `Bearer ${accessToken}`;
    options.headers.Accept = '*/*';
    options.credentials = 'include';
    return await fetch(url, options);
  }
}
