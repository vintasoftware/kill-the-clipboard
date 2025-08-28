import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { SHLManifestBuilder } from 'kill-the-clipboard';
import { buildMedplumFetch } from '@/lib/medplum-fetch';
import { getManifestBuilder, getStoredPasscode } from '@/lib/storage';
import { verifyPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/medplum-file-handlers';

const medplum = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL || 'https://api.medplum.com',
  clientId: process.env.MEDPLUM_CLIENT_ID!,
  clientSecret: process.env.MEDPLUM_CLIENT_SECRET!,
});

interface ManifestRequest {
  recipient: string;
  passcode?: string;
  embeddedLengthMax?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entropy: string }> }
) {
  // Get authorization header and authenticate with Medplum
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
  }

  // Set the authorization header for the server-side client
  const accessToken = authHeader.replace('Bearer ', '');
  medplum.setAccessToken(accessToken);

  // Verify the user is authenticated
  const profile = await medplum.getProfileAsync();
  if (!profile) {
    return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
  }

  const { entropy } = await params;
  const body: ManifestRequest = await request.json();
  const { recipient, passcode, embeddedLengthMax = 4096 } = body;

  // Validate required fields
  if (!recipient) {
    return NextResponse.json(
      { error: 'Recipient is required' },
      { status: 400 }
    );
  }

  // Retrieve the stored manifest builder state
  const builderState = await getManifestBuilder(entropy);
  if (!builderState) {
    return NextResponse.json(
      { error: 'Smart Health Link not found' },
      { status: 404 }
    );
  }

  // Check if passcode is required and validate it
  const storedPasscodeHash = await getStoredPasscode(entropy);
  if (storedPasscodeHash) {
    if (!passcode) {
      return NextResponse.json(
        { error: 'Passcode is required' },
        { status: 401 }
      );
    }

    if (!verifyPasscode(passcode, storedPasscodeHash)) {
      return NextResponse.json(
        { error: 'Invalid passcode' },
        { status: 401 }
      );
    }
  }

  // Reconstruct the manifest builder
  const manifestBuilder = SHLManifestBuilder.deserialize({
    data: builderState,
    ...createManifestFileHandlers(medplum),
    // Provide Medplum-authenticated fetch
    fetch: buildMedplumFetch(medplum),
  });

  // Build and return the manifest
  const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax });

  // Set appropriate headers
  const response = NextResponse.json(manifest);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

  return response;
}

export async function OPTIONS() {
  // Handle CORS preflight request
  const response = new NextResponse(null, { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}
