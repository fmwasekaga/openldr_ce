import { probe } from '@openldr/core';
import type { ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';

export interface Dhis2Config {
  baseUrl: string;
  username: string;
  password: string;
}

export interface Dhis2Deps {
  fetch?: typeof fetch;
}

export interface Dhis2Target extends ReportingTargetPort {
  close(): Promise<void>;
}

interface ImportSummary {
  status?: string;
  importCount?: { imported?: number; updated?: number; ignored?: number; deleted?: number };
  response?: { status?: string; importCount?: { imported?: number; updated?: number; ignored?: number; deleted?: number }; conflicts?: { object?: string; value?: string }[] };
  conflicts?: { object?: string; value?: string }[];
}

export function createDhis2Target(cfg: Dhis2Config, deps: Dhis2Deps = {}): Dhis2Target {
  const doFetch = deps.fetch ?? fetch;
  const base = cfg.baseUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' };

  async function getJson<T>(path: string): Promise<T> {
    const res = await doFetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`DHIS2 ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async healthCheck() {
      return probe(async () => { await getJson('/api/system/info.json'); });
    },
    async pullMetadata(): Promise<TargetMetadata> {
      const de = await getJson<{ dataElements?: { id: string; name: string }[] }>('/api/dataElements.json?fields=id,name&paging=false');
      const ou = await getJson<{ organisationUnits?: { id: string; name: string }[] }>('/api/organisationUnits.json?fields=id,name&paging=false');
      const coc = await getJson<{ categoryOptionCombos?: { id: string; name: string }[] }>('/api/categoryOptionCombos.json?fields=id,name&paging=false');
      return {
        dataElements: de.dataElements ?? [],
        orgUnits: ou.organisationUnits ?? [],
        categoryOptionCombos: coc.categoryOptionCombos ?? [],
      };
    },
    async pushAggregate(payload): Promise<PushResult> {
      const res = await doFetch(`${base}/api/dataValueSets.json`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const text = await res.text();
      let parsed: ImportSummary | undefined;
      try { parsed = text ? (JSON.parse(text) as ImportSummary) : undefined; } catch { parsed = undefined; }
      // DHIS2 returns a full ImportSummary even on HTTP 409 (conflicts). Treat the response as a
      // hard failure only when it carries no usable import summary (e.g. 401/5xx with a non-JSON body).
      const hasSummary = !!parsed && typeof parsed === 'object' &&
        (parsed.status !== undefined || parsed.response !== undefined || parsed.importCount !== undefined);
      if (!hasSummary) {
        throw new Error(`DHIS2 dataValueSets -> ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
      }
      const summary = parsed as ImportSummary;
      const ic = summary.importCount ?? summary.response?.importCount ?? {};
      const rawStatus = (summary.response?.status ?? summary.status ?? '').toUpperCase();
      const status: PushResult['status'] =
        rawStatus === 'ERROR' ? 'error'
        : rawStatus === 'WARNING' ? 'warning'
        : rawStatus === 'SUCCESS' || rawStatus === 'OK' ? 'success'
        : res.ok ? 'success' : 'error';
      const conflicts = (summary.conflicts ?? summary.response?.conflicts ?? []).map((c) => ({ object: c.object ?? '', value: c.value ?? '' }));
      return {
        status,
        imported: ic.imported ?? 0,
        updated: ic.updated ?? 0,
        ignored: ic.ignored ?? 0,
        deleted: ic.deleted ?? 0,
        conflicts,
        raw: summary,
      };
    },
    async close() { /* fetch-based; nothing to close */ },
  };
}
