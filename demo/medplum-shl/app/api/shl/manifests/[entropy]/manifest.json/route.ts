import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { SHLExpiredError, SHLManifestBuilder } from 'kill-the-clipboard';
import { buildMedplumFetch } from '@/lib/medplum-fetch';
import { createMedplumStorage } from '@/lib/medplum-storage';
import { verifyPasscode } from '@/lib/auth';
import { buildManifestFileHandlers } from '@/lib/medplum-file-handlers';

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

  // Create Medplum storage instance
  const storage = createMedplumStorage(medplum);

  // Get the maximum allowed failed attempts from environment variable (default: 100)
  const maxFailedAttempts = parseInt(process.env.SHL_SERVER_MAX_FAILED_ATTEMPTS || '100', 10);

  // Check if SHL is invalidated due to too many failed attempts
  if (await storage.isSHLInvalidated(entropy)) {
    // Record failed access attempt
    try {
      await storage.recordAccess(entropy, recipient, 'failure', 'SHL invalidated');
    } catch (error) {
      console.error('Error recording access for invalidated SHL:', error);
    }
    return NextResponse.json(
      { error: 'Smart Health Link not found' },
      { status: 404 }
    );
  }

  // Retrieve the stored SHL payload and builder attributes
  const shlPayload = await storage.getSHL(entropy);
  const builderAttrs = await storage.getManifestBuilder(entropy);
  if (!shlPayload || !builderAttrs) {
    // Record failed access attempt
    try {
      await storage.recordAccess(entropy, recipient, 'failure', 'SHL not found');
    } catch (error) {
      console.error('Error recording access for non-existent SHL:', error);
    }
    return NextResponse.json(
      { error: 'Smart Health Link not found' },
      { status: 404 }
    );
  }

  // Check if passcode is required and validate it
  const storedPasscodeHash = await storage.getStoredPasscode(entropy);
  if (storedPasscodeHash) {
    if (!passcode) {
      // Record failed access attempt
      try {
        await storage.recordAccess(entropy, recipient, 'failure', 'Passcode required but not provided');
      } catch (error) {
        console.error('Error recording access for missing passcode:', error);
      }
      return NextResponse.json(
        { error: 'Passcode is required' },
        { status: 401 }
      );
    }

    if (!(await verifyPasscode(passcode, storedPasscodeHash))) {
      // Increment failed attempts and check if SHL should be invalidated
      const { attempts, invalidated } = await storage.incrementFailedAttempts(entropy, maxFailedAttempts);

      // Record failed access attempt
      try {
        await storage.recordAccess(
          entropy,
          recipient,
          'failure',
          `Invalid passcode (attempt ${attempts}/${maxFailedAttempts})`
        );
      } catch (error) {
        console.error('Error recording access for invalid passcode:', error);
      }

      if (invalidated) {
        // Return 404 instead of 401 to hide the fact that the SHL exists
        return NextResponse.json(
          { error: 'Smart Health Link not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Invalid passcode', remainingAttempts: maxFailedAttempts - attempts },
        { status: 401 }
      );
    }
  }

  // Reconstruct the manifest builder
  const manifestBuilder = SHLManifestBuilder.fromDBAttrs({
    shl: shlPayload,
    attrs: builderAttrs,
    ...buildManifestFileHandlers(medplum),
    // Provide Medplum-authenticated fetch
    fetch: buildMedplumFetch(medplum),
  });

  try {
    // Build and return the manifest
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax });

    // Record successful access
    try {
      await storage.recordAccess(entropy, recipient, 'success', 'Manifest successfully retrieved');
    } catch (error) {
      console.error('Error recording successful access:', error);
    }

    const response = NextResponse.json(manifest);
    return response;
  } catch (error) {
    if (error instanceof SHLExpiredError) {
      // Record failed access attempt for expired SHL
      try {
        await storage.recordAccess(entropy, recipient, 'failure', 'SHL expired');
      } catch (auditError) {
        console.error('Error recording access for expired SHL:', auditError);
      }

      return NextResponse.json(
        { error: 'Smart Health Link not found' },
        { status: 404 }
      );
    }
    // Re-throw other errors
    throw error;
  }
}
