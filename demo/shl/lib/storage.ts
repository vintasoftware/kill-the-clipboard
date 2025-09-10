import { SerializedSHLManifestBuilder } from 'kill-the-clipboard';
import { PrismaClient } from '@prisma/client';
import { JsonObject } from '@prisma/client/runtime/library';

// Prisma-based storage for demo purposes

const prisma = new PrismaClient();

export async function storeManifestBuilder(
  entropy: string,
  builderState: SerializedSHLManifestBuilder,
): Promise<void> {
  await prisma.manifest.upsert({
    where: { entropy },
    update: {
      builderState: builderState as unknown as JsonObject,
    },
    create: {
      entropy,
      builderState: builderState as unknown as JsonObject,
    },
  });
}

export async function getManifestBuilder(entropy: string): Promise<SerializedSHLManifestBuilder | null> {
  const manifest = await prisma.manifest.findUnique({
    where: { entropy },
  });

  if (!manifest) {
    return null;
  }

  return manifest.builderState as unknown as SerializedSHLManifestBuilder;
}

export async function storePasscode(entropy: string, hashedPasscode: string): Promise<void> {
  await prisma.passcode.upsert({
    where: { entropy },
    update: {
      hashedPasscode,
    },
    create: {
      entropy,
      hashedPasscode,
    },
  });
}

export async function getStoredPasscode(entropy: string): Promise<string | null> {
  const passcode = await prisma.passcode.findUnique({
    where: { entropy },
  });

  return passcode?.hashedPasscode || null;
}

export async function isSHLInvalidated(entropy: string): Promise<boolean> {
  const passcode = await prisma.passcode.findUnique({
    where: { entropy },
  });

  return passcode?.isInvalidated || false;
}

export async function incrementFailedAttempts(entropy: string, maxAttempts: number): Promise<{ invalidated: boolean; attempts: number }> {
  const updated = await prisma.passcode.update({
    where: { entropy },
    data: {
      failedAttempts: {
        increment: 1,
      },
    },
  });

  const shouldInvalidate = updated.failedAttempts >= maxAttempts;

  if (shouldInvalidate && !updated.isInvalidated) {
    await prisma.passcode.update({
      where: { entropy },
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
