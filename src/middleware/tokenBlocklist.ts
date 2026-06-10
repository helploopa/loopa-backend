import crypto from 'crypto';

// In-memory JWT revocation list: SHA-256(token) -> expiry timestamp (ms)
// Survives the lifetime of the process; acceptable for single-instance / Vercel serverless.
const blocklist = new Map<string, number>();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [hash, expiry] of blocklist) {
    if (expiry < now) blocklist.delete(hash);
  }
}

export function revokeToken(token: string, expiresAt: number): void {
  blocklist.set(hashToken(token), expiresAt);
  purgeExpired();
}

export function isRevoked(token: string): boolean {
  const hash = hashToken(token);
  const expiry = blocklist.get(hash);
  if (expiry === undefined) return false;
  if (expiry < Date.now()) {
    blocklist.delete(hash);
    return false;
  }
  return true;
}
