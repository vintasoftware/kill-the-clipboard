import { SerializedSHLManifestBuilder } from 'kill-the-clipboard';
import { PrismaClient } from '@prisma/client';

// Prisma-based storage for demo purposes

const prisma = new PrismaClient();

export async function storeManifestBuilder(
  entropy: string,
  builderState: SerializedSHLManifestBuilder,
): Promise<void> {
  await prisma.manifest.upsert({
    where: { entropy },
    update: {
      builderState: JSON.stringify(builderState),
    },
    create: {
      entropy,
      builderState: JSON.stringify(builderState),
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

  return JSON.parse(manifest.builderState);
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
