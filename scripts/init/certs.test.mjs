import { describe, it, expect } from 'vitest';
import { planCerts } from './certs.mjs';

describe('planCerts', () => {
  it('self-signed → openssl command with the host CN', () => {
    const p = planCerts({ tlsMode: 'self-signed', host: 'lab.example.org' });
    expect(p.kind).toBe('exec');
    expect(p.command).toContain('openssl');
    expect(p.command).toContain('CN=lab.example.org');
  });
  it('byo → copy the provided cert/key', () => {
    const p = planCerts({ tlsMode: 'byo', certPath: '/tmp/f.pem', keyPath: '/tmp/k.pem' });
    expect(p.kind).toBe('copy');
    expect(p.files).toEqual([
      { from: '/tmp/f.pem', to: 'deploy/nginx/certs/fullchain.pem' },
      { from: '/tmp/k.pem', to: 'deploy/nginx/certs/privkey.pem' },
    ]);
  });
  it('letsencrypt → certbot plan with domain+email', () => {
    const p = planCerts({ tlsMode: 'letsencrypt', host: 'lab.example.org', email: 'ops@example.org' });
    expect(p.kind).toBe('certbot');
    expect(p.domain).toBe('lab.example.org');
    expect(p.email).toBe('ops@example.org');
  });
  it('unknown mode throws', () => {
    expect(() => planCerts({ tlsMode: 'nope' })).toThrow();
  });
});
