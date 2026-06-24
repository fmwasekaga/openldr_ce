import { useEffect, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { Modal } from '../components/Modal';

/** A mapping doc as stored in the `mappings` collection. */
interface MappingDoc {
  id: string;
  name: string;
  definition?: {
    kind?: string;
    connectorId?: string;
    [k: string]: unknown;
  };
}

/** An org-unit map doc as stored in the `orgUnitMaps` collection (Task 7). */
interface OrgUnitMapDoc {
  facilityId: string;
  orgUnitId: string;
}

/**
 * The RunOutcome the host returns from `connectors.push` (see
 * packages/bootstrap/src/dhis2-orchestration.ts). For aggregate the values live
 * in `build.payload.dataValues`; for tracker in `build.payload.events`.
 */
interface RunOutcome {
  kind: 'aggregate' | 'tracker';
  dryRun: boolean;
  build: {
    payload: { dataValues?: unknown[]; events?: unknown[] };
    skipped: Array<{ row: number; reason: string }>;
  };
  result?: {
    status: string;
    imported: number;
    updated: number;
    ignored: number;
    conflicts: unknown[];
  };
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mappingKind(m: MappingDoc): string {
  return m.definition?.kind ?? 'aggregate';
}

export function Mappings({ onNavigate }: { onNavigate?: (screen: string, id?: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [rows, setRows] = useState<MappingDoc[]>([]);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [pendingDelete, setPendingDelete] = useState<MappingDoc | null>(null);

  const [running, setRunning] = useState<MappingDoc | null>(null);
  const [period, setPeriod] = useState('');
  const [runResult, setRunResult] = useState<RunOutcome | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  async function load() {
    const raw = await getOpenldr().storage.list('mappings');
    setRows(asArray<{ doc: MappingDoc }>(raw).map((e) => e.doc));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await getOpenldr().ready;
        await load();
        if (alive) setPhase({ phase: 'ready' });
      } catch (e) {
        if (alive) setPhase({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        document.body.setAttribute('data-openldr-ready', '1');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Auto-dismiss the toast after ~5s, mirroring the host screen.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  function openRun(m: MappingDoc) {
    setRunning(m);
    setPeriod('');
    setRunResult(null);
    setRunErr(null);
  }

  async function doRun(dryRun: boolean) {
    if (!running) return;
    setRunBusy(true);
    setRunErr(null);
    try {
      const o = getOpenldr();
      // Load the full mapping doc + build the facilityId→orgUnitId map.
      const doc = (await o.storage.get('mappings', running.id)) as MappingDoc | null;
      const definition = doc?.definition;
      if (!definition) throw new Error('mapping has no definition');
      const connectorId = definition.connectorId;
      if (!connectorId) throw new Error('mapping has no connector configured');

      const mapsRaw = await o.storage.list('orgUnitMaps');
      const orgUnitMap: Record<string, string> = {};
      for (const e of asArray<{ doc: OrgUnitMapDoc }>(mapsRaw)) {
        if (e.doc?.facilityId && e.doc?.orgUnitId) orgUnitMap[e.doc.facilityId] = e.doc.orgUnitId;
      }

      const outcome = (await o.connectors.push({
        connectorId,
        mapping: definition,
        orgUnitMap,
        period,
        dryRun,
      })) as RunOutcome;
      setRunResult(outcome);
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  }

  async function doDelete() {
    if (!pendingDelete) return;
    const m = pendingDelete;
    setPendingDelete(null);
    try {
      await getOpenldr().storage.delete('mappings', m.id);
      setToast({ kind: 'ok', text: `Deleted ${m.name}` });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const valueCount = runResult
    ? runResult.build.payload.dataValues?.length ?? runResult.build.payload.events?.length ?? 0
    : 0;

  return (
    <div class="dhis2" data-testid="dhis2-mappings-page">
      <div class="mappings-head">
        <h1>Mappings</h1>
        <button type="button" class="btn" data-testid="new-mapping" onClick={() => onNavigate?.('new')}>
          New mapping
        </button>
      </div>
      <p class="muted">Mappings turn report rows into DHIS2 data values or tracker events.</p>

      {phase.phase === 'loading' && <p class="status muted">Loading…</p>}
      {phase.phase === 'error' && <div class="error" role="alert">{phase.message}</div>}

      {toast && (
        <div class={toast.kind === 'ok' ? 'toast toast-ok' : 'toast toast-err'} role="status">
          {toast.text}
        </div>
      )}

      {phase.phase === 'ready' && (
        <table class="table mappings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="mappings-kind-col">Kind</th>
              <th class="mappings-actions-col" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} class="muted mappings-empty">No mappings yet.</td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} data-testid={`mapping-row-${m.id}`}>
                  <td class="mappings-name">{m.name}</td>
                  <td><span class="badge">{mappingKind(m)}</span></td>
                  <td>
                    <div class="mappings-row-actions">
                      <button type="button" class="link" data-testid={`run-${m.id}`} onClick={() => openRun(m)}>
                        Run
                      </button>
                      <button type="button" class="link" data-testid={`edit-${m.id}`} onClick={() => onNavigate?.('edit', m.id)}>
                        Edit
                      </button>
                      <button type="button" class="link mappings-del" data-testid={`delete-${m.id}`} onClick={() => setPendingDelete(m)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      <Modal
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        onClose={() => setPendingDelete(null)}
      >
        <p class="muted">This mapping will be removed. This cannot be undone.</p>
        <div class="modal-actions">
          <button type="button" class="link" onClick={() => setPendingDelete(null)}>Cancel</button>
          <button type="button" class="btn mappings-confirm-del" data-testid="confirm-delete" onClick={() => void doDelete()}>
            Delete
          </button>
        </div>
      </Modal>

      <Modal
        open={running !== null}
        title={`Run ${running?.name ?? ''}`}
        onClose={() => setRunning(null)}
      >
        <div class="run-form">
          {runErr && <div class="error" role="alert">{runErr}</div>}
          <label class="run-field">
            <span class="muted">Period</span>
            <input
              class="run-input"
              data-testid="run-period"
              value={period}
              placeholder="e.g. 202401"
              onInput={(e) => setPeriod((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <div class="run-actions">
            <button
              type="button"
              class="btn run-dry-btn"
              data-testid="run-dry"
              disabled={runBusy || !period}
              onClick={() => void doRun(true)}
            >
              Dry run
            </button>
            <button
              type="button"
              class="btn"
              data-testid="run-push"
              disabled={runBusy || !period}
              onClick={() => void doRun(false)}
            >
              Push
            </button>
          </div>

          {runResult && (
            <div class="run-result" data-testid="run-result">
              <div>
                Values: <span class="run-num">{valueCount}</span> · Skipped:{' '}
                <span class="run-num">{runResult.build.skipped.length}</span>
              </div>
              {runResult.build.skipped.length > 0 && (
                <ul class="run-skipped">
                  {runResult.build.skipped.slice(0, 10).map((s, i) => (
                    <li key={i}>row {s.row}: {s.reason}</li>
                  ))}
                </ul>
              )}
              {runResult.result && (
                <div class="run-push-result">
                  Push result: <span class="run-num">{runResult.result.status}</span> — imported{' '}
                  {runResult.result.imported} · updated {runResult.result.updated} · ignored{' '}
                  {runResult.result.ignored} · conflicts {runResult.result.conflicts.length}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
