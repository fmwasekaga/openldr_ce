export type AuthFailReason =
  | 'missing' | 'expired' | 'bad-signature' | 'wrong-audience' | 'wrong-issuer'
  | 'no-matching-key' | 'invalid' | 'account-disabled' | 'sync-failed';

/** Derive a stable reason from a jose (or other) verification error. Never inspects the token. */
export function reasonFromError(e: unknown): AuthFailReason {
  const code = (e as { code?: string } | null)?.code;
  const claim = (e as { claim?: string } | null)?.claim;
  switch (code) {
    case 'ERR_JWT_EXPIRED': return 'expired';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED': return 'bad-signature';
    case 'ERR_JWKS_NO_MATCHING_KEY': return 'no-matching-key';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return claim === 'iss' ? 'wrong-issuer' : claim === 'aud' ? 'wrong-audience' : 'invalid';
    default: return 'invalid';
  }
}

/** In-memory dedup: returns true if this (key,reason) should be RECORDED now (first in window), false to
 *  collapse a repeat. Prunes expired entries on each call so the map stays bounded. */
export function createAuthFailedThrottle(opts: { windowMs?: number; now?: () => number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const seen = new Map<string, number>();
  return function shouldRecord(key: string, reason: AuthFailReason): boolean {
    const t = now();
    for (const [k, exp] of seen) if (exp <= t) seen.delete(k);
    const id = `${key}::${reason}`;
    if (seen.has(id)) return false;
    seen.set(id, t + windowMs);
    return true;
  };
}

/** Best-effort decode of the `sub` claim from a JWT WITHOUT verifying (for actor identity on a rejected
 *  token). Returns null on any problem. Never throws. */
export function subFromUnverifiedToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}
