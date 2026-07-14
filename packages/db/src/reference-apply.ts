import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceEntityType, ReferenceOp } from './reference-change-log';

// Distributed sync S2: capture-free reference-data applier. A LAB uses this to apply reference
// changes PULLED from central. Unlike the capturing config stores (createDashboardStore/…), this
// writes the four target tables DIRECTLY — it does NOT go through those stores — so NO
// reference_change_log rows are emitted on the lab (labs mirror central; they don't re-originate).
// Every managed row is stamped managed_origin='central', and deletes are guarded by that stamp so a
// lab-local (managed_origin NULL) row that happens to share an id is never touched. Modelled on
// applyRemote() in fhir-store.ts (capture-free, direct-table, ON CONFLICT upsert, origin stamping).

export interface ReferenceRecord {
  entityType: ReferenceEntityType;
  entityId: string;
  op: ReferenceOp;
  contentHash?: string | null;
  body?: unknown; // present for op:'upsert'; the store's served body (dashboards/reports/formSyncBody)
}

export type ApplyRefResult = 'applied' | 'skipped';

const MANAGED = 'central';

// --- wire body shapes (the OUTPUT of each store's get/serve, arriving here over JSON) ---
interface DashboardBody {
  name: string;
  ownerId?: string | null;
  isDefault?: boolean;
  refreshIntervalSec?: number;
  filters?: unknown[];
  widgets?: unknown[];
  layout?: unknown[];
}
interface ReportBody {
  name: string;
  description?: string;
  category: string;
  designId: string;
  primaryQueryId: string;
  summaryMetrics?: unknown[] | null;
  chart?: unknown | null;
  paramOptions?: Record<string, string> | null;
  status: string;
}
interface FormBody {
  name: string;
  status: string;
  active: boolean;
  schema: unknown;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
}
interface PublisherBody {
  name: string;
  role: string;
  icon?: string | null;
  matchPrefixes?: unknown[];
  sortOrder?: number;
}
interface CodingSystemBody {
  systemCode: string;
  systemName: string;
  url?: string | null;
  systemVersion?: string | null;
  description?: string | null;
  active?: boolean;
  publisherId?: string | null;
}
interface TermMappingBody {
  fromSystem: string;
  fromCode: string;
  toSystem: string;
  toCode: string;
  toDisplay?: string | null;
  mapType: string;
  relationship?: string | null;
  owner?: string | null;
  isActive?: boolean;
}

// --- row mappers: mirror each store's toRow serialization EXACTLY (jsonb columns are TEXT holding
// JSON, so arrays/objects are JSON.stringify'd). Each row includes managed_origin='central'. ---

// Mirrors packages/dashboards/src/store.ts toRow.
function dashboardRow(id: string, body: unknown) {
  const d = body as DashboardBody;
  return {
    id,
    owner_id: d.ownerId ?? null,
    name: d.name,
    layout: JSON.stringify(d.layout ?? []),
    widgets: JSON.stringify(d.widgets ?? []),
    filters: JSON.stringify(d.filters ?? []),
    refresh_interval_sec: d.refreshIntervalSec ?? 0,
    is_default: d.isDefault ?? false,
    managed_origin: MANAGED,
  };
}

// Mirrors packages/db/src/report-store.ts toRow.
function reportRow(id: string, body: unknown) {
  const r = body as ReportBody;
  return {
    id,
    name: r.name,
    description: r.description ?? '',
    category: r.category,
    design_id: r.designId,
    primary_query_id: r.primaryQueryId,
    summary_metrics: r.summaryMetrics == null ? null : JSON.stringify(r.summaryMetrics),
    chart: r.chart == null ? null : JSON.stringify(r.chart),
    param_options: r.paramOptions == null ? null : JSON.stringify(r.paramOptions),
    status: r.status,
    managed_origin: MANAGED,
  };
}

// Maps formSyncBody's output → form_definitions columns. `name` is carried by formSyncBody (it must
// be — the column is NOT NULL with no default). updated_at is stamped now(); created_at defaults.
function formRow(id: string, body: unknown) {
  const f = body as FormBody;
  return {
    id,
    name: f.name,
    status: f.status,
    active: f.active,
    schema: JSON.stringify(f.schema),
    fhir_version: f.fhirVersion ?? null,
    fhir_profile_url: f.fhirProfileUrl ?? null,
    facility_id: f.facilityId ?? null,
    managed_origin: MANAGED,
    updated_at: sql`now()`,
  };
}

// Maps the served publisher body → publishers columns. match_prefixes is a jsonb column (TEXT
// holding JSON), so the array is JSON.stringify'd. NOT NULL cols (name/role) are carried by the body.
function publisherRow(id: string, body: unknown) {
  const p = body as PublisherBody;
  return {
    id,
    name: p.name,
    role: p.role,
    icon: p.icon ?? null,
    match_prefixes: JSON.stringify(p.matchPrefixes ?? []),
    sort_order: p.sortOrder ?? 0,
    managed_origin: MANAGED,
  };
}

// Maps the served coding_system body → coding_systems columns. NOT NULL cols (system_code/
// system_name) are carried by the body; active defaults to true when absent.
function codingSystemRow(id: string, body: unknown) {
  const c = body as CodingSystemBody;
  return {
    id,
    system_code: c.systemCode,
    system_name: c.systemName,
    url: c.url ?? null,
    system_version: c.systemVersion ?? null,
    description: c.description ?? null,
    active: c.active ?? true,
    publisher_id: c.publisherId ?? null,
    managed_origin: MANAGED,
  };
}

// Maps the served term_mapping body → term_mappings columns. created_at/updated_at have DB defaults;
// updated_at is stamped now() on every apply. `owner` is carried from central's body (preserved).
function termMappingRow(id: string, body: unknown) {
  const t = body as TermMappingBody;
  return {
    id,
    from_system: t.fromSystem,
    from_code: t.fromCode,
    to_system: t.toSystem,
    to_code: t.toCode,
    to_display: t.toDisplay ?? null,
    map_type: t.mapType,
    relationship: t.relationship ?? null,
    owner: t.owner ?? null,
    is_active: t.isActive ?? true,
    managed_origin: MANAGED,
    updated_at: sql`now()`,
  };
}

type ManagedTable =
  | 'dashboards'
  | 'reports'
  | 'form_definitions'
  | 'publishers'
  | 'coding_systems'
  | 'term_mappings';

// Direct-write upsert/delete for a managed table. delete is guarded by managed_origin='central' so a
// lab-local (NULL) row is never removed; upsert stamps/re-stamps managed_origin on conflict. The
// dynamic table name uses the `(db as any)` escape hatch — the row builders above carry the typing
// for the fiddly column-mapping part.
async function upsertOrDelete(
  db: Kysely<InternalSchema>,
  table: ManagedTable,
  id: string,
  op: ReferenceOp,
  body: unknown,
  toRow: (id: string, body: unknown) => Record<string, unknown>,
): Promise<ApplyRefResult> {
  const q = db as unknown as Kysely<Record<string, never>>;
  if (op === 'delete') {
    await (q as any)
      .deleteFrom(table)
      .where('id', '=', id)
      .where('managed_origin', '=', MANAGED)
      .execute();
    return 'applied';
  }
  const row = toRow(id, body);
  const { id: _omitId, ...update } = row; // ON CONFLICT DO UPDATE never rewrites the PK
  await (q as any)
    .insertInto(table)
    .values(row)
    .onConflict((oc: any) => oc.column('id').doUpdateSet(update))
    .execute();
  return 'applied';
}

// Settings have no managed_origin column — the pull allowlist governs which keys sync, so a delete is
// an unguarded delete-by-key. updated_by is stamped 'central' to mark the origin.
async function applySetting(db: Kysely<InternalSchema>, rec: ReferenceRecord): Promise<ApplyRefResult> {
  if (rec.op === 'delete') {
    await db.deleteFrom('app_settings').where('key', '=', rec.entityId).execute();
    return 'applied';
  }
  const value = String(rec.body);
  await db
    .insertInto('app_settings')
    .values({ key: rec.entityId, value, updated_by: MANAGED, updated_at: sql`now()` })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_by: MANAGED, updated_at: sql`now()` }))
    .execute();
  return 'applied';
}

export function createReferenceApplier(db: Kysely<InternalSchema>) {
  return async function applyReferenceChange(rec: ReferenceRecord): Promise<ApplyRefResult> {
    // Validate before writing: an upsert must carry a body (guards the non-null cast in the row
    // builders and avoids an opaque NOT NULL violation deep in the insert).
    if (rec.op === 'upsert' && rec.body == null) throw new Error('applyReferenceChange: upsert requires body');
    switch (rec.entityType) {
      case 'dashboard':
        return upsertOrDelete(db, 'dashboards', rec.entityId, rec.op, rec.body, dashboardRow);
      case 'report':
        return upsertOrDelete(db, 'reports', rec.entityId, rec.op, rec.body, reportRow);
      case 'form':
        return upsertOrDelete(db, 'form_definitions', rec.entityId, rec.op, rec.body, formRow);
      case 'publisher':
        return upsertOrDelete(db, 'publishers', rec.entityId, rec.op, rec.body, publisherRow);
      case 'coding_system':
        return upsertOrDelete(db, 'coding_systems', rec.entityId, rec.op, rec.body, codingSystemRow);
      case 'term_mapping':
        return upsertOrDelete(db, 'term_mappings', rec.entityId, rec.op, rec.body, termMappingRow);
      case 'setting':
        return applySetting(db, rec);
      default:
        throw new Error(`applyReferenceChange: unknown entityType ${(rec as ReferenceRecord).entityType}`);
    }
  };
}
