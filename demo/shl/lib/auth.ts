import { createHash, timingSafeEqual, randomBytes } from 'crypto';

// Simple password hashing using SHA-256 with salt
// In production, consider using bcrypt or Argon2 for better security

const SALT_LENGTH = 32;

export function hashPasscode(passcode: string, salt?: Buffer): { hash: string; salt: string } {
  const saltBuffer = salt || randomBytes(SALT_LENGTH);

  // Simple hash implementation for demo
  // In production, use proper PBKDF2 or Argon2
  const combined = Buffer.concat([Buffer.from(passcode, 'utf8'), saltBuffer]);
  const hash = createHash('sha256').update(combined).digest('hex');
  const saltHex = saltBuffer.toString('hex');

  return {
    hash: `${hash}:${saltHex}`,
    salt: saltHex
  };
}

export function verifyPasscode(passcode: string, storedHash: string): boolean {
  try {
    const [hash, salt] = storedHash.split(':');
    if (!hash || !salt) return false;

    const saltBuffer = Buffer.from(salt, 'hex');
    const { hash: computedHash } = hashPasscode(passcode, saltBuffer);
    const [computedHashOnly] = computedHash.split(':');

    // Use timing-safe comparison
    const hashBuffer1 = Buffer.from(hash, 'hex');
    const hashBuffer2 = Buffer.from(computedHashOnly, 'hex');

    if (hashBuffer1.length !== hashBuffer2.length) return false;

    return timingSafeEqual(hashBuffer1, hashBuffer2);
  } catch (error) {
    console.error('Error verifying passcode:', error);
    return false;
  }
}
