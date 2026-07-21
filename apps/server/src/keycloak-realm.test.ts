import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const realmPath = resolve(here, '../../../infra/keycloak/openldr-realm.json');

interface RealmRole { name: string }
interface RealmClient { clientId: string; publicClient?: boolean; serviceAccountsEnabled?: boolean; secret?: string }
interface RealmUser { username: string; realmRoles?: string[]; credentials?: { type: string }[]; requiredActions?: string[]; serviceAccountClientId?: string }
interface Realm {
  realm: string; enabled: boolean;
  loginTheme?: string;
  roles: { realm: RealmRole[] };
  clients: RealmClient[];
  users: RealmUser[];
}

const APP_ROLES = ['lab_admin', 'lab_manager', 'lab_technician', 'data_analyst', 'system_auditor'];

describe('openldr realm export', () => {
  const realm = JSON.parse(readFileSync(realmPath, 'utf8')) as Realm;

  it('declares the openldr realm, enabled', () => {
    expect(realm.realm).toBe('openldr');
    expect(realm.enabled).toBe(true);
  });

  it('selects the openldr login theme', () => {
    expect(realm.loginTheme).toBe('openldr');
  });

  it('defines all app realm roles', () => {
    const names = realm.roles.realm.map((r) => r.name);
    for (const role of APP_ROLES) expect(names).toContain(role);
  });

  it('has a public web login client with PKCE + redirect URIs', () => {
    const web = realm.clients.find((c) => c.clientId === 'openldr-web');
    expect(web).toBeTruthy();
    expect(web!.publicClient).toBe(true);
    const raw = JSON.stringify(web);
    expect(raw).toContain('pkce'); // pkce.code.challenge.method attribute present
    expect(raw).toContain('redirectUris');
  });

  it('has a confidential admin service-account client with user-management roles', () => {
    const admin = realm.clients.find((c) => c.clientId === 'openldr-admin');
    expect(admin).toBeTruthy();
    expect(admin!.serviceAccountsEnabled).toBe(true);
    expect(typeof admin!.secret).toBe('string');
    // realm-management client roles must be granted to the service account
    const raw = JSON.stringify(realm);
    expect(raw).toContain('manage-users');
    expect(raw).toContain('view-users');
    // client-management roles required so central can mint each lab's sync client (sync S4d)
    expect(raw).toContain('manage-clients');
    expect(raw).toContain('view-clients');
  });

  it('seeds a labadmin user holding lab_admin with a password credential', () => {
    const u = realm.users.find((x) => x.username === 'labadmin');
    expect(u).toBeTruthy();
    expect(u!.realmRoles).toContain('lab_admin');
    expect(u!.credentials?.some((c) => c.type === 'password')).toBe(true);
  });

  it('forces labadmin to change the seeded password at first login', () => {
    // temporary:true on a realm-import credential does NOT attach the required action, so the
    // seeded password must change at first login is enforced explicitly (verified live: without
    // this, labadmin logs straight through with no forced change).
    const u = realm.users.find((x) => x.username === 'labadmin');
    expect(u!.requiredActions).toContain('UPDATE_PASSWORD');
  });
});
