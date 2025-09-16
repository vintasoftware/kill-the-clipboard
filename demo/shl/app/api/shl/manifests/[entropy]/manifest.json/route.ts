import { NextRequest, NextResponse } from 'next/server';
import { SHLExpiredError, SHLManifestBuilder } from 'kill-the-clipboard';
import { getManifestBuilder, getSHL, getStoredPasscode, isSHLInvalidated, incrementFailedAttempts, findSHLIdByEntropy, trackRecipientAccess } from '@/lib/storage';
import { verifyPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/filesystem-file-handlers';

interface ManifestRequest {
  recipient: string;
  passcode?: string;
  embeddedLengthMax?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entropy: string }> }
) {
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

  // Find the SHL ID using the entropy part of the URL (/manifests/[entropy]/manifest.json)
  const shlId = await findSHLIdByEntropy(entropy);
  if (!shlId) {
    return NextResponse.json(
      { error: 'SMART Health Link not found' },
      { status: 404 }
    );
  }

  // Get the maximum allowed failed attempts from environment variable (default: 100)
  const maxFailedAttempts = parseInt(process.env.SHL_SERVER_MAX_FAILED_ATTEMPTS || '100', 10);

  // Check if SHL is invalidated due to too many failed attempts
  if (await isSHLInvalidated(shlId)) {
    return NextResponse.json(
      { error: 'SMART Health Link not found' },
      { status: 404 }
    );
  }

  // Retrieve the DB stored manifest builder attributes
  const shlPayload = await getSHL(shlId);
  const builderAttrs = await getManifestBuilder(shlId);
  if (!shlPayload || !builderAttrs) {
    return NextResponse.json(
      { error: 'SMART Health Link not found' },
      { status: 404 }
    );
  }

  // Check if passcode is required and validate it
  const storedPasscodeHash = await getStoredPasscode(shlId);
  if (storedPasscodeHash) {
    if (!passcode) {
      return NextResponse.json(
        { error: 'Passcode is required' },
        { status: 401 }
      );
    }

    if (!(await verifyPasscode(passcode, storedPasscodeHash))) {
      // Increment failed attempts and check if SHL should be invalidated
      const { attempts, invalidated } = await incrementFailedAttempts(shlId, maxFailedAttempts);

      if (invalidated) {
        // Return 404 instead of 401 to hide the fact that the SHL exists
        return NextResponse.json(
          { error: 'SMART Health Link not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Invalid passcode', remainingAttempts: maxFailedAttempts - attempts },
        { status: 401 }
      );
    }
  }

  // Track recipient access
  await trackRecipientAccess(shlId, recipient);

  // Reconstruct the manifest builder
  const manifestBuilder = SHLManifestBuilder.fromDBAttrs({
    shl: shlPayload,
    attrs: builderAttrs,
    ...createManifestFileHandlers(),
  });

  try {
    // Build and return the manifest
    const manifest = await manifestBuilder.buildManifest({ embeddedLengthMax });

    const response = NextResponse.json(manifest);
    return response;
  } catch (error) {
    if (error instanceof SHLExpiredError) {
      return NextResponse.json(
        { error: 'SMART Health Link not found' },
        { status: 404 }
      );
    }
    // Re-throw other errors
    throw error;
  }
}
