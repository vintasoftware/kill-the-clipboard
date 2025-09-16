import { SHLManifestBuilderDBAttrs, SHLManifestFileDBAttrs, SHLinkPayloadV1 } from 'kill-the-clipboard';
import { PrismaClient } from '@prisma/client';
import { JsonObject } from '@prisma/client/runtime/library';

// Prisma-based storage for demo purposes

const prisma = new PrismaClient();

export async function createSHL(payload: SHLinkPayloadV1, entropy: string): Promise<string> {
  const shl = await prisma.shl.create({
    data: {
      entropy,
      payload: payload as unknown as JsonObject,
    },
  });

  return shl.id;
}

export async function getSHL(shlId: string): Promise<SHLinkPayloadV1 | null> {
  const shl = await prisma.shl.findUnique({
    where: { id: shlId },
  });

  if (!shl) {
    return null;
  }

  return shl.payload as unknown as SHLinkPayloadV1;
}


export async function storeManifestBuilder(
  shlId: string,
  builderAttrs: SHLManifestBuilderDBAttrs,
): Promise<void> {
  // Start a transaction to ensure consistency
  await prisma.$transaction(async (tx) => {
    // Upsert the manifest record
    const manifest = await tx.manifest.upsert({
      where: { shlId },
      update: {},
      create: {
        shlId,
      },
    });

    // Delete existing files for this manifest
    await tx.manifestFile.deleteMany({
      where: { manifestId: manifest.id },
    });

    // Insert new files
    if (builderAttrs.files.length > 0) {
      await tx.manifestFile.createMany({
        data: builderAttrs.files.map(file => ({
          manifestId: manifest.id,
          type: file.type,
          storagePath: file.storagePath,
          ciphertextLength: file.ciphertextLength,
          lastUpdated: file.lastUpdated,
        })),
      });
    }
  });
}

export async function getManifestBuilder(shlId: string): Promise<SHLManifestBuilderDBAttrs | null> {
  const manifest = await prisma.manifest.findUnique({
    where: { shlId },
    include: {
      files: true,
    },
  });

  if (!manifest) {
    return null;
  }

  const files: SHLManifestFileDBAttrs[] = manifest.files.map(file => ({
    type: file.type as SHLManifestFileDBAttrs['type'],
    storagePath: file.storagePath,
    ciphertextLength: file.ciphertextLength,
    lastUpdated: file.lastUpdated || undefined,
  }));

  return {
    files,
  };
}

export async function storePasscode(shlId: string, hashedPasscode: string): Promise<void> {
  await prisma.passcode.upsert({
    where: { shlId },
    update: {
      hashedPasscode,
    },
    create: {
      shlId,
      hashedPasscode,
    },
  });
}

export async function getStoredPasscode(shlId: string): Promise<string | null> {
  const passcode = await prisma.passcode.findUnique({
    where: { shlId },
  });

  return passcode?.hashedPasscode || null;
}

export async function isSHLInvalidated(shlId: string): Promise<boolean> {
  const passcode = await prisma.passcode.findUnique({
    where: { shlId },
  });

  return passcode?.isInvalidated || false;
}

export async function incrementFailedAttempts(shlId: string, maxAttempts: number): Promise<{ invalidated: boolean; attempts: number }> {
  const updated = await prisma.passcode.update({
    where: { shlId },
    data: {
      failedAttempts: {
        increment: 1,
      },
    },
  });

  const shouldInvalidate = updated.failedAttempts >= maxAttempts;

  if (shouldInvalidate && !updated.isInvalidated) {
    await prisma.passcode.update({
      where: { shlId },
      data: {
        isInvalidated: true,
      },
    });
  }

  return {
    invalidated: shouldInvalidate,
    attempts: updated.failedAttempts,
  };
}

export function extractEntropyFromURL(url: string): string | null {
  // URL format: https://shl.example.org/manifests/{entropy}/manifest.json
  const match = url.match(/\/manifests\/([^/]+)\/?.*/);
  return match ? match[1] : null;
}

export async function findSHLIdByEntropy(entropy: string): Promise<string | null> {
  const shl = await prisma.shl.findUnique({
    where: { entropy },
    select: { id: true },
  });

  return shl?.id || null;
}

export async function trackRecipientAccess(shlId: string, recipient: string): Promise<void> {
  await prisma.recipient.create({
    data: {
      shlId,
      recipient,
    },
  });
}
