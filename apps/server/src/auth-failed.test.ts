import { describe, expect, it } from 'vitest';
import { reasonFromError, createAuthFailedThrottle, subFromUnverifiedToken } from './auth-failed';

describe('reasonFromError', () => {
  it('maps jose error codes to reasons', () => {
    expect(reasonFromError({ code: 'ERR_JWT_EXPIRED' })).toBe('expired');
    expect(reasonFromError({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })).toBe('bad-signature');
    expect(reasonFromError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' })).toBe('wrong-audience');
    expect(reasonFromError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' })).toBe('wrong-issuer');
    expect(reasonFromError(new Error('whatever'))).toBe('invalid');
  });
});
describe('createAuthFailedThrottle', () => {
  it('collapses repeats of the same (key,reason) within the window', () => {
    let t = 1000;
    const throttle = createAuthFailedThrottle({ windowMs: 60_000, now: () => t });
    expect(throttle('1.2.3.4', 'expired')).toBe(true);
    expect(throttle('1.2.3.4', 'expired')).toBe(false);
    expect(throttle('1.2.3.4', 'invalid')).toBe(true);
    t += 61_000;
    expect(throttle('1.2.3.4', 'expired')).toBe(true);
  });
});
describe('subFromUnverifiedToken', () => {
  it('extracts sub from an unverified jwt payload, null on garbage', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'user-123' })).toString('base64url');
    expect(subFromUnverifiedToken(`h.${payload}.sig`)).toBe('user-123');
    expect(subFromUnverifiedToken('not-a-jwt')).toBeNull();
    expect(subFromUnverifiedToken('')).toBeNull();
  });
});
