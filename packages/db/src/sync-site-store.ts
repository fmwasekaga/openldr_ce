import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S4d: central-side registry of enrolled labs. Records site_id, the minted Keycloak
// client_id, who/when enrolled, and an active/revoked status. NEVER stores the client secret — the
// secret is returned once at enroll/rotate time and never persisted here.
export interface SyncSiteRow {
  siteId: string;
  name: string | null;
  clientId: string;
  enrolledAt: string;
  enrolledBy: string | null;
  status: 'active' | 'revoked';
  // Sync S5: the site's ed25519 SPKI DER public signing key (hex), or null if not yet exchanged.
  // Central verifies the lab's push bundles with it; the PRIVATE key is never stored here.
  signingPublicKey: string | null;
}

export interface SyncSiteStore {
  list(): Promise<SyncSiteRow[]>;
  get(siteId: string): Promise<SyncSiteRow | undefined>;
  insert(row: { siteId: string; name: string | null; clientId: string; enrolledBy: string | null }): Promise<void>;
  setStatus(siteId: string, status: 'active' | 'revoked'): Promise<void>;
  // Sync S5: record the site's public signing key (hex SPKI DER) exchanged at enroll/rotate.
  setSigningPublicKey(siteId: string, hexDer: string): Promise<void>;
  // Sync S5: the lab's last-applied 'sync-pull' position (0 when unknown/null).
  getReportedPullCursor(siteId: string): Promise<number>;
  setReportedPullCursor(siteId: string, seq: number): Promise<void>;
}

function fromRow(r: {
  site_id: string; name: string | null; client_id: string;
  enrolled_at: Date; enrolled_by: string | null; status: string;
  signing_public_key: string | null;
}): SyncSiteRow {
  return {
    siteId: r.site_id,
    name: r.name,
    clientId: r.client_id,
    enrolledAt: new Date(r.enrolled_at).toISOString(),
    enrolledBy: r.enrolled_by,
    status: r.status as 'active' | 'revoked',
    signingPublicKey: r.signing_public_key,
  };
}

export function createSyncSiteStore(db: Kysely<InternalSchema>): SyncSiteStore {
  return {
    // Newest enrolment first — mirrors the report-run-store's created_at desc ordering.
    async list() {
      const rows = await db.selectFrom('sync_sites').selectAll().orderBy('enrolled_at', 'desc').execute();
      return rows.map(fromRow);
    },
    async get(siteId) {
      const r = await db.selectFrom('sync_sites').selectAll().where('site_id', '=', siteId).executeTakeFirst();
      return r ? fromRow(r) : undefined;
    },
    async insert(row) {
      await db
        .insertInto('sync_sites')
        .values({
          site_id: row.siteId,
          name: row.name,
          client_id: row.clientId,
          enrolled_by: row.enrolledBy,
        })
        .execute();
    },
    async setStatus(siteId, status) {
      await db.updateTable('sync_sites').set({ status }).where('site_id', '=', siteId).execute();
    },
    // Persist ONLY the public key — the site's private key is never stored centrally.
    async setSigningPublicKey(siteId, hexDer) {
      await db.updateTable('sync_sites').set({ signing_public_key: hexDer }).where('site_id', '=', siteId).execute();
    },
    async getReportedPullCursor(siteId) {
      const r = await db
        .selectFrom('sync_sites')
        .select('reported_pull_cursor')
        .where('site_id', '=', siteId)
        .executeTakeFirst();
      return Number(r?.reported_pull_cursor ?? 0);
    },
    async setReportedPullCursor(siteId, seq) {
      await db
        .updateTable('sync_sites')
        .set({ reported_pull_cursor: String(seq) })
        .where('site_id', '=', siteId)
        .execute();
    },
  };
}
