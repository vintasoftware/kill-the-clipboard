import argon2 from 'argon2';

export async function hashPasscode(passcode: string): Promise<{ hash: string }> {
  try {
    // Use Argon2id variant with OWASP recommended parameters
    const hash = await argon2.hash(passcode, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MiB in KiB
      timeCost: 2,       // 2 iterations
      parallelism: 1,    // Single thread
    });

    return { hash };
  } catch (error) {
    console.error('Error hashing passcode:', error);
    throw new Error('Failed to hash passcode');
  }
}

export async function verifyPasscode(passcode: string, storedHash: string): Promise<boolean> {
  try {
    // Use Argon2's built-in verification with timing-safe comparison
    return await argon2.verify(storedHash, passcode);
  } catch (error) {
    console.error('Error verifying passcode:', error);
    return false;
  }
}
