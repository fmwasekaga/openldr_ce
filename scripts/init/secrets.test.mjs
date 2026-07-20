import { describe, it, expect } from 'vitest';
import { ensureStackSecrets, patchRealmSecrets, randomSecret } from './secrets.mjs';

// Deterministic generator: a counter so each call is distinct and assertions are exact.
function seqGen() {
  let n = 0;
  return () => `GEN${++n}`;
}

const EXAMPLE = [
  'INTERNAL_DATABASE_URL=postgres://openldr:openldr@postgres:5432/openldr',
  'TARGET_DATABASE_URL=postgres://openldr:openldr@postgres:5432/openldr_target',
  'POSTGRES_PASSWORD=openldr',
  'S3_ACCESS_KEY_ID=minioadmin',
  'S3_SECRET_ACCESS_KEY=minioadmin',
  'KEYCLOAK_ADMIN=admin',
  'KEYCLOAK_ADMIN_PASSWORD=admin',
  'KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret',
  '',
].join('\n');

describe('ensureStackSecrets', () => {
  it('replaces every committed weak default with a generated secret', () => {
    const { envText } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(envText).not.toMatch(/POSTGRES_PASSWORD=openldr$/m);
    expect(envText).not.toMatch(/S3_ACCESS_KEY_ID=minioadmin$/m);
    expect(envText).not.toMatch(/S3_SECRET_ACCESS_KEY=minioadmin$/m);
    expect(envText).not.toMatch(/KEYCLOAK_ADMIN_PASSWORD=admin$/m);
    expect(envText).not.toMatch(/KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret$/m);
    // KEYCLOAK_ADMIN is a username, not a secret — left untouched.
    expect(envText).toMatch(/^KEYCLOAK_ADMIN=admin$/m);
  });

  it('rewrites both postgres URLs to the regenerated password', () => {
    const { envText } = ensureStackSecrets(EXAMPLE, seqGen());
    const pg = /^POSTGRES_PASSWORD=(.+)$/m.exec(envText)[1];
    expect(envText).toContain(`INTERNAL_DATABASE_URL=postgres://openldr:${pg}@postgres:5432/openldr`);
    expect(envText).toContain(`TARGET_DATABASE_URL=postgres://openldr:${pg}@postgres:5432/openldr_target`);
    // No lingering plaintext default password in the URLs.
    expect(envText).not.toContain('openldr:openldr@');
  });

  it('mints and persists an initial lab-admin password, returned for realm patching', () => {
    const { envText, labAdminPassword } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(labAdminPassword).toBeTruthy();
    expect(envText).toContain(`INITIAL_LAB_ADMIN_PASSWORD=${labAdminPassword}`);
  });

  it('is idempotent — a second pass keeps already-generated secrets (never rotates a live secret)', () => {
    const first = ensureStackSecrets(EXAMPLE, seqGen());
    // A fresh generator on the second pass would produce different values IF anything were regenerated.
    const second = ensureStackSecrets(first.envText, () => 'SHOULD_NOT_APPEAR');
    expect(second.envText).toBe(first.envText);
    expect(second.envText).not.toContain('SHOULD_NOT_APPEAR');
    expect(second.labAdminPassword).toBe(first.labAdminPassword);
  });

  it('returns the kc client secret it wrote', () => {
    const { envText, kcClientSecret } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(kcClientSecret).toBeTruthy();
    expect(envText).toContain(`KEYCLOAK_ADMIN_CLIENT_SECRET=${kcClientSecret}`);
  });
});

describe('patchRealmSecrets', () => {
  const realm = JSON.stringify({
    clients: [{ clientId: 'openldr-admin', secret: 'openldr-admin-dev-secret' }],
    users: [{ username: 'labadmin', credentials: [{ type: 'password', value: 'labadmin', temporary: true }] }],
  }, null, 0).replace('"value":"labadmin"', '"value": "labadmin"');

  it('substitutes the admin client secret and the labadmin credential, not the username', () => {
    const out = patchRealmSecrets(realm, { kcClientSecret: 'KC_SECRET', labAdminPassword: 'LAB_PW' });
    expect(out).not.toContain('openldr-admin-dev-secret');
    expect(out).toContain('KC_SECRET');
    expect(out).toContain('"value": "LAB_PW"');
    // The username labadmin is preserved (only the credential value changed).
    expect(out).toContain('"username":"labadmin"');
  });
});

describe('randomSecret', () => {
  it('produces a url-safe alnum string of the requested length', () => {
    const s = randomSecret(40);
    expect(s).toHaveLength(40);
    expect(s).toMatch(/^[A-Za-z0-9]+$/);
  });
});
