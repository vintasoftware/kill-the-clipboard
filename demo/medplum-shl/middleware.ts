import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Accept cross-origin requests on manifest.json route
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Apply CORS headers only to API routes
  if (request.nextUrl.pathname.startsWith('/api/shl/manifests/')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true'); // If you need to send cookies/credentials
  }

  return response;
}

export const config = {
  matcher: '/api/shl/manifests/:path*',
};
