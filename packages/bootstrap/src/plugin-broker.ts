import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { beginOp } from '@openldr/core';
import { readGrant, type Capability } from '@openldr/marketplace';
import type { PluginDataStore } from '@openldr/db';
import type { PluginPolicy } from './policy';
import { policyAllows } from './policy';

/** The caller principal (the authenticated host user forwarding on the plugin's behalf). */
export interface BrokerPrincipal {
  id: string;
  roles: string[];
  /** Display name for the audit trail; falls back to id when absent. */
  username?: string;
}

/** A security-relevant broker event for the audit trail. `outcome:'denied'` is a blocked op
 *  (capability/role/policy/egress gate or a malformed op); `outcome:'ok'` is a completed
 *  SENSITIVE op (wasm invoke or a live egress op). High-frequency reads are not emitted. */
export interface BrokerAuditEvent {
  pluginId: string;
  principal: BrokerPrincipal;
  op: string;
  outcome: 'denied' | 'ok';
  reason?: string;
}

/** Operations a plugin UI may request. storage.* is private (namespaced by the trusted
 *  pluginId); invoke runs the plugin's own wasm; the rest are gated host ops. */
export type BrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'reports.eventSources' }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string }
  | { kind: 'connectors.metadata'; id: string }
  | { kind: 'connectors.push'; connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }
  | { kind: 'connectors.validate'; connectorId: string; mapping: unknown }
  | { kind: 'fhir.facilities' }
  | { kind: 'schedule.register'; schedule: unknown }
  | { kind: 'schedule.list' }
  | { kind: 'schedule.remove'; id: string };

export type BrokerResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Default cap on the JSON byte size of a persisted/forwarded plugin document. Generous —
 *  the dhis2-sink metadataCache:latest doc holds a full DHIS2 metadata snapshot (1000+ data
 *  elements, a few MB). Overridable via PLUGIN_DATA_MAX_DOC_BYTES. */
export const DEFAULT_MAX_DOC_BYTES = 8 * 1024 * 1024;

const STR = z.string().min(1).max(256);
const ID = z.string().min(1).max(256);

/** Build the discriminated-union op schema. `maxDocBytes` bounds any persisted/forwarded
 *  arbitrary-object payload (doc/mapping/schedule/input) by its serialized byte size. */
export function buildBrokerOpSchema(maxDocBytes: number) {
  const docBound = (label: string) =>
    z.unknown().superRefine((v, ctx) => {
      let bytes = 0;
      try {
        bytes = Buffer.byteLength(JSON.stringify(v ?? null));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not serializable` });
        return;
      }
      if (bytes > maxDocBytes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} exceeds ${maxDocBytes} bytes (${bytes})` });
      }
    });

  return z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('storage.get'), collection: STR, key: STR }),
    z.object({ kind: z.literal('storage.put'), collection: STR, key: STR, doc: docBound('doc') }),
    z.object({ kind: z.literal('storage.delete'), collection: STR, key: STR }),
    z.object({ kind: z.literal('storage.list'), collection: STR, where: z.object({ field: STR, eq: z.unknown() }).optional(), limit: z.number().int().min(1).max(1000).optional() }),
    z.object({ kind: z.literal('invoke'), entrypoint: STR, input: docBound('input') }),
    z.object({ kind: z.literal('reports.list') }),
    z.object({ kind: z.literal('reports.columns'), id: ID }),
    z.object({ kind: z.literal('reports.run'), id: ID, params: docBound('params').optional() }),
    z.object({ kind: z.literal('reports.eventSources') }),
    z.object({ kind: z.literal('connectors.list') }),
    z.object({ kind: z.literal('connectors.test'), id: ID }),
    z.object({ kind: z.literal('connectors.metadata'), id: ID }),
    z.object({ kind: z.literal('connectors.push'), connectorId: ID, mapping: docBound('mapping'), orgUnitMap: z.record(z.string().max(256)).optional(), period: STR, dryRun: z.boolean() }),
    z.object({ kind: z.literal('connectors.validate'), connectorId: ID, mapping: docBound('mapping') }),
    z.object({ kind: z.literal('fhir.facilities') }),
    z.object({ kind: z.literal('schedule.register'), schedule: docBound('schedule') }),
    z.object({ kind: z.literal('schedule.list') }),
    z.object({ kind: z.literal('schedule.remove'), id: ID }),
  ]);
}

/** Maps an op to the capability it requires (undefined = private/no capability). */
function gateFor(op: BrokerOp): string | undefined {
  switch (op.kind) {
    case 'reports.list': case 'reports.columns': case 'reports.run': case 'reports.eventSources': return 'host:reports';
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata': case 'connectors.push': case 'connectors.validate': return 'host:connectors';
    case 'fhir.facilities': return 'host:fhir';
    case 'schedule.register': case 'schedule.list': case 'schedule.remove': return 'host:schedule';
    default: return undefined; // storage.*, invoke
  }
}

/** Does this op make a LIVE outbound network request when dispatched? These ops gate to the
 *  `host:connectors` capability (NOT `net-egress`), so `policyAllows` does not cover them — the
 *  egress kill-switch (PLUGIN_EGRESS_ENABLED=false) is enforced for them at the OP level in
 *  `handle`. Each resolves a connector → decrypts its config → contacts the configured host:
 *   - connectors.test      live health_check + pull_metadata
 *   - connectors.metadata  live pull_metadata
 *   - connectors.push      live push to the target
 *   - connectors.validate  live pull_metadata to validate the mapping against
 *  connectors.list is DB-only (no egress) and is intentionally excluded. */
function egresses(op: BrokerOp): boolean {
  switch (op.kind) {
    case 'connectors.test':
    case 'connectors.metadata':
    case 'connectors.push':
    case 'connectors.validate':
      return true;
    default:
      return false;
  }
}

/** Required caller-role set for an op (empty = no role requirement). The capability is the
 *  plugin's ceiling; the CALLER's role is a separate axis, matching the native routes. */
function rolesFor(op: BrokerOp): string[] {
  switch (op.kind) {
    // Mirrors the native /api/connectors routes (lab_admin only).
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata':
    case 'connectors.push': case 'connectors.validate':
    // Schedule register/list/remove mirror the native lab_admin-gated schedule routes.
    case 'schedule.register': case 'schedule.list': case 'schedule.remove':
      return ['lab_admin'];
    // storage.*, invoke, reports.*, fhir.* — reports/fhir reads are broadly readable (native routes have no role gate).
    default: return [];
  }
}

export interface PluginBrokerDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<{ invoke(entrypoint: string, input: unknown, opts?: unknown): Promise<unknown> } | undefined>;
  };
  pluginData: PluginDataStore;
  reporting: { list(): unknown; columns(id: string): Promise<unknown>; run(id: string, params: unknown): Promise<unknown>; eventSources(): unknown };
  connectors: { list(): Promise<unknown[]>; get(id: string): Promise<unknown | null> };
  /** Test a connector live (resolve→loadSink→health/metadata). Optional here; wired in app
   *  context. When absent, connectors.test returns a structured error. */
  testConnector?: (id: string) => Promise<unknown>;
  /** Pull live metadata for a connector (resolve→loadSink→pull_metadata). */
  connectorMetadata?: (id: string) => Promise<unknown>;
  /** Run a DHIS2 push for a caller-supplied mapping/orgUnitMap through a connector's sink. */
  connectorPush?: (input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }) => Promise<unknown>;
  /** Validate a caller-supplied mapping against a connector's live metadata → string[]. */
  connectorValidate?: (input: { connectorId: string; mapping: unknown }) => Promise<unknown>;
  /** List FHIR Location facilities ({ id, name }[]) for the org-unit mapping screen. */
  facilities?: () => Promise<unknown>;
  /** Plugin-scoped schedule registry (wired in Task 4; undefined until then). */
  schedules?: { register(pluginId: string, schedule: unknown): Promise<unknown>; list(pluginId: string): Promise<unknown>; remove(pluginId: string, id: string): Promise<unknown> };
  policy: () => PluginPolicy;
  /** Max serialized byte size of a persisted/forwarded plugin doc. Defaults to DEFAULT_MAX_DOC_BYTES. */
  maxDocBytes?: number;
  /** Optional: server-side sink for redacted host-op error detail (never sent to the plugin). */
  logger?: { warn(obj: unknown, msg: string): void };
  /** Optional: best-effort audit sink for security-relevant broker events (denials + sensitive
   *  ops). Wired to ctx.audit in the AppContext. Must never throw into the broker. */
  audit?: (event: BrokerAuditEvent) => Promise<void>;
}

export interface PluginBroker {
  handle(pluginId: string, principal: BrokerPrincipal, op: unknown): Promise<BrokerResult>;
}

export function createPluginBroker(deps: PluginBrokerDeps): PluginBroker {
  function hasCapability(caps: Capability[], gate: string): boolean {
    return caps.some((c) => c.kind === gate);
  }

  const brokerOpSchema = buildBrokerOpSchema(deps.maxDocBytes ?? DEFAULT_MAX_DOC_BYTES);

  // Best-effort audit — never throws into the broker (audit must not break or block-fail an op).
  async function emit(pluginId: string, principal: BrokerPrincipal, op: string, outcome: 'denied' | 'ok', reason?: string): Promise<void> {
    try {
      await deps.audit?.({ pluginId, principal, op, outcome, reason });
    } catch { /* swallow — auditing a security event must not break the op */ }
  }

  return {
    async handle(pluginId, principal, rawOp) {
      // Records the denial to the audit trail, then returns the structured error.
      const deny = async (op: string, reason: string): Promise<BrokerResult> => {
        await emit(pluginId, principal, op, 'denied', reason);
        return { ok: false, error: reason };
      };
      // Parse FIRST so a malformed op can't probe installed-plugin state or dispatch.
      const parsed = brokerOpSchema.safeParse(rawOp);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ').slice(0, 300);
        return deny('(unparsed)', `invalid operation: ${msg}`);
      }
      const op: BrokerOp = parsed.data as BrokerOp;
      try {
        // 1. Plugin must be installed + enabled.
        const rows = await deps.plugins.list();
        const row = rows.find((r) => r.id === pluginId && r.enabled);
        if (!row) return deny(op.kind, `plugin ${pluginId} is not installed or disabled`);

        // 1b. Plugin-level required-roles gate — applies to EVERY op (incl. storage.*/invoke),
        // independent of and in addition to the per-op rolesFor() gate below. This is the
        // authorization boundary the native DHIS2 routes had: a plugin declaring
        // ui.requiredRoles:['lab_admin'] is fully off-limits to callers lacking those roles.
        const requiredRoles = (row.manifest as { payload?: { ui?: { requiredRoles?: string[] } } }).payload?.ui?.requiredRoles;
        if (requiredRoles?.length && !requiredRoles.some((r) => principal.roles.includes(r))) {
          return deny(op.kind, `plugin ${pluginId} requires one of roles: ${requiredRoles.join(', ')}`);
        }

        // 2. Global policy (kill-switches) — checked on EVERY call.
        const gate = gateFor(op);
        if (!policyAllows(deps.policy(), gate)) {
          return deny(op.kind, `operation ${op.kind} is disabled by global policy`);
        }

        // 2b. Egress kill-switch — connector ops gate to host:connectors (not net-egress), so
        // policyAllows can't see them; enforce PLUGIN_EGRESS_ENABLED for them here, before
        // capability/role/dispatch, so a false kill-switch blocks every outbound connector op.
        if (egresses(op) && !deps.policy().egressEnabled) {
          return deny(op.kind, `operation ${op.kind} is disabled by the egress kill-switch`);
        }

        // 3. Capability grant. Legacy rows (no capabilities field) are grandfathered.
        if (gate) {
          const grant = readGrant(row.manifest);
          if (!grant.legacy && !hasCapability(grant.capabilities, gate)) {
            return deny(op.kind, `operation ${op.kind} requires the ${gate} capability, which plugin ${pluginId} was not granted`);
          }
        }

        // Role gate: capability is the plugin's ceiling; the CALLER's role is a separate axis.
        const need = rolesFor(op);
        if (need.length > 0 && !need.some((r) => principal.roles.includes(r))) {
          return deny(op.kind, `operation ${op.kind} requires one of roles: ${need.join(', ')}`);
        }

        // 4. Dispatch. Storage is namespaced by the trusted pluginId argument.
        // Stamp wasm-invoking / egress ops in the in-flight registry (pluginId + op kind +
        // entrypoint) so a process-FATAL plugin crash mid-dispatch leaves a culprit trail the
        // uncaughtException handler can snapshot. The wasm boundary (createWasmSink) stamps too;
        // this adds the broker's richer op-kind label. Cleared in `finally`.
        const stamp = op.kind === 'invoke' || egresses(op)
          ? beginOp({ pluginId, op: op.kind, entrypoint: op.kind === 'invoke' ? op.entrypoint : undefined })
          : undefined;
        try {
        switch (op.kind) {
          case 'storage.get': return { ok: true, data: await deps.pluginData.get(pluginId, op.collection, op.key) };
          case 'storage.put': await deps.pluginData.put(pluginId, op.collection, op.key, op.doc); return { ok: true, data: null };
          case 'storage.delete': await deps.pluginData.delete(pluginId, op.collection, op.key); return { ok: true, data: null };
          case 'storage.list': return { ok: true, data: await deps.pluginData.list(pluginId, op.collection, { where: op.where, limit: op.limit }) };
          case 'invoke': {
            const sink = await deps.plugins.loadSink(pluginId, row.version);
            if (!sink) return { ok: false, error: `plugin ${pluginId} exposes no invokable wasm` };
            const data = await sink.invoke(op.entrypoint, op.input);
            await emit(pluginId, principal, `invoke:${op.entrypoint}`, 'ok'); // wasm execution
            return { ok: true, data };
          }
          case 'reports.list': return { ok: true, data: deps.reporting.list() };
          case 'reports.columns': return { ok: true, data: await deps.reporting.columns(op.id) };
          case 'reports.run': return { ok: true, data: await deps.reporting.run(op.id, op.params ?? {}) };
          case 'reports.eventSources': return { ok: true, data: deps.reporting.eventSources() };
          case 'connectors.list': return { ok: true, data: await deps.connectors.list() };
          case 'connectors.test': {
            if (!deps.testConnector) return { ok: false, error: 'connectors.test is unavailable' };
            const data = await deps.testConnector(op.id);
            await emit(pluginId, principal, `connectors.test:${op.id}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'connectors.metadata': {
            if (!deps.connectorMetadata) return { ok: false, error: 'connectors.metadata unavailable' };
            const data = await deps.connectorMetadata(op.id);
            await emit(pluginId, principal, `connectors.metadata:${op.id}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'connectors.push': {
            if (!deps.connectorPush) return { ok: false, error: 'connectors.push unavailable' };
            const data = await deps.connectorPush({ connectorId: op.connectorId, mapping: op.mapping, orgUnitMap: op.orgUnitMap, period: op.period, dryRun: op.dryRun });
            await emit(pluginId, principal, `connectors.push:${op.connectorId}`, 'ok', op.dryRun ? 'dry-run' : 'live'); // live egress
            return { ok: true, data };
          }
          case 'connectors.validate': {
            if (!deps.connectorValidate) return { ok: false, error: 'connectors.validate unavailable' };
            const data = await deps.connectorValidate({ connectorId: op.connectorId, mapping: op.mapping });
            await emit(pluginId, principal, `connectors.validate:${op.connectorId}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'fhir.facilities': {
            if (!deps.facilities) return { ok: false, error: 'fhir.facilities unavailable' };
            return { ok: true, data: await deps.facilities() };
          }
          case 'schedule.register': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.register(pluginId, op.schedule) };
          }
          case 'schedule.list': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.list(pluginId) };
          }
          case 'schedule.remove': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.remove(pluginId, op.id) };
          }
          default: return { ok: false, error: `unknown operation` };
        }
        } finally {
          stamp?.();
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Redact secret/egress-bearing host-op errors before they reach the untrusted plugin.
        // The plugin (and its UI) only sees a generic message + a correlation id; the full detail
        // goes to the server log under the SAME id, so an operator can grep the log for the ref
        // shown in the UI without any secret ever reaching the iframe.
        if (gateFor(op) === 'host:connectors') {
          const correlationId = randomUUID().slice(0, 8);
          deps.logger?.warn({ op: op.kind, pluginId, correlationId, detail }, 'plugin broker host op failed');
          return { ok: false, error: `operation ${op.kind} failed (ref: ${correlationId})` };
        }
        return { ok: false, error: detail };
      }
    },
  };
}
