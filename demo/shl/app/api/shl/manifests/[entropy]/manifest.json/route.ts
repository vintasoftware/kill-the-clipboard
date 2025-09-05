import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { SHLExpiredError, SHLManifestBuilder } from 'kill-the-clipboard';
import { buildMedplumFetch } from '@/lib/medplum-fetch';
import { getManifestBuilder, getStoredPasscode } from '@/lib/storage';
import { verifyPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/medplum-file-handlers';

const medplum = new MedplumClient({
  baseUrl: process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'https://api.medplum.com',
  clientId: process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID!,
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

  try {
    // Build and return the manifest
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax });

    const response = NextResponse.json(manifest);
    return response;
  } catch (error) {
    if (error instanceof SHLExpiredError) {
      return NextResponse.json(
        { error: 'Smart Health Link not found' },
        { status: 404 }
      );
    }
    // Re-throw other errors
    throw error;
  }
}
