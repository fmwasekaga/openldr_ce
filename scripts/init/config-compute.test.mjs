import { describe, it, expect } from 'vitest';
import { computeEnv } from './config-compute.mjs';

describe('computeEnv', () => {
  it('derives origin/issuer/jwks/redirect for a domain on 443', () => {
    const e = computeEnv({ host: 'lab.example.org', tlsMode: 'letsencrypt', httpPort: 80, httpsPort: 443, email: 'ops@example.org' });
    expect(e.SERVER_NAME).toBe('lab.example.org');
    expect(e.PUBLIC_ORIGIN).toBe('https://lab.example.org');
    expect(e.OIDC_ISSUER_URL).toBe('https://lab.example.org/auth/realms/openldr');
    expect(e.OIDC_INTERNAL_JWKS_URL).toBe('http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs');
    expect(e.KC_HOSTNAME).toBe('https://lab.example.org/auth');
    expect(e.TLS_MODE).toBe('letsencrypt');
    expect(e.LETSENCRYPT_EMAIL).toBe('ops@example.org');
  });
  it('includes the port in the origin when https != 443', () => {
    const e = computeEnv({ host: '192.168.1.20', tlsMode: 'self-signed', httpPort: 8080, httpsPort: 8443 });
    expect(e.PUBLIC_ORIGIN).toBe('https://192.168.1.20:8443');
    expect(e.OIDC_ISSUER_URL).toBe('https://192.168.1.20:8443/auth/realms/openldr');
    expect(e.KC_HOSTNAME).toBe('https://192.168.1.20:8443/auth');
    expect(e.LETSENCRYPT_EMAIL).toBeUndefined();
    expect(e.GATEWAY_HTTP_PORT).toBe('8080');
    expect(e.GATEWAY_HTTPS_PORT).toBe('8443');
  });
});
