import { useEffect, useMemo, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { Picker } from '../components/Picker';
import { t } from '../i18n';

/** A schedule doc as stored in the plugin `schedules` collection (migration 036). */
interface ScheduleDoc {
  id: string;
  mappingId: string;
  mode: 'aggregate' | 'tracker';
  periodType: string;
  eventDriven: boolean;
  enabled: boolean;
  lastRunAt?: string | null;
  nextDueAt?: string | null;
}

/** A mapping doc as stored in the `mappings` collection. */
interface MappingDoc {
  id: string;
  name: string;
  definition?: { kind?: string };
}

type PeriodType = 'monthly' | 'quarterly' | 'yearly';

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function Schedules() {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [rows, setRows] = useState<ScheduleDoc[]>([]);
  const [mappings, setMappings] = useState<MappingDoc[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduleDoc | null>(null);

  const [newMapping, setNewMapping] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState<PeriodType>('monthly');
  const [newEventDriven, setNewEventDriven] = useState(false);

  async function load() {
    const o = getOpenldr();
    const [schedRaw, mapsRaw] = await Promise.all([
      o.schedule.list(),
      o.storage.list('mappings'),
    ]);
    setRows(asArray<ScheduleDoc>(schedRaw));
    setMappings(asArray<{ doc: MappingDoc }>(mapsRaw).map((e) => e.doc));
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

  // Auto-dismiss the error toast after ~5s, mirroring the host screen.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const mappingOptions = useMemo(
    () => mappings.map((m) => ({ value: m.id, label: m.name })),
    [mappings],
  );
  const mappingNameById = useMemo(
    () => new Map(mappings.map((m) => [m.id, m.name])),
    [mappings],
  );

  function fail(e: unknown) {
    setToast(e instanceof Error ? e.message : String(e));
  }

  async function onCreate() {
    if (!newMapping) return;
    const m = mappings.find((x) => x.id === newMapping);
    const mode = m?.definition?.kind === 'tracker' ? 'tracker' : 'aggregate';
    try {
      await getOpenldr().schedule.register({
        mappingId: newMapping,
        periodType: newPeriod,
        eventDriven: newEventDriven,
        mode,
      });
      setNewMapping(null);
      setNewPeriod('monthly');
      setNewEventDriven(false);
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function onToggle(s: ScheduleDoc) {
    try {
      await getOpenldr().schedule.register({ ...s, enabled: !s.enabled });
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function doDelete() {
    if (!pendingDelete) return;
    const s = pendingDelete;
    setPendingDelete(null);
    try {
      await getOpenldr().schedule.remove(s.id);
      await load();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div class="dhis2" data-testid="dhis2-schedules-page">
      <h1>{t('schedules.title')}</h1>
      <p class="muted">{t('schedules.subtitle')}</p>

      {phase.phase === 'loading' && <p class="status muted">{t('common.loading')}</p>}
      {phase.phase === 'error' && <div class="error" role="alert">{phase.message}</div>}

      {toast && (
        <div class="toast toast-err" role="status">{toast}</div>
      )}

      {phase.phase === 'ready' && (
        <>
          <div class="sched-form">
            <div class="sched-field">
              <span class="muted">{t('schedules.mapping')}</span>
              <Picker
                options={mappingOptions}
                value={newMapping}
                onChange={(v) => setNewMapping(v)}
                placeholder={t('schedules.pickMapping')}
                searchPlaceholder={t('schedules.searchMappings')}
                disabled={mappingOptions.length === 0}
                testId="new-mapping"
              />
            </div>
            <label class="sched-field">
              <span class="muted">{t('schedules.period')}</span>
              <select
                class="sched-select"
                data-testid="new-period"
                value={newPeriod}
                onChange={(e) => setNewPeriod((e.currentTarget as HTMLSelectElement).value as PeriodType)}
              >
                <option value="monthly">{t('schedules.monthly')}</option>
                <option value="quarterly">{t('schedules.quarterly')}</option>
                <option value="yearly">{t('schedules.yearly')}</option>
              </select>
            </label>
            <label class="sched-check">
              <input
                type="checkbox"
                checked={newEventDriven}
                onChange={(e) => setNewEventDriven((e.currentTarget as HTMLInputElement).checked)}
              />
              {t('schedules.eventDriven')}
            </label>
            <button
              type="button"
              class="btn"
              data-testid="create-schedule"
              disabled={!newMapping}
              onClick={() => void onCreate()}
            >
              {t('schedules.create')}
            </button>
          </div>

          <table class="table sched-table">
            <thead>
              <tr>
                <th>{t('schedules.mapping')}</th>
                <th>{t('schedules.period')}</th>
                <th>{t('schedules.eventDriven')}</th>
                <th>{t('schedules.enabled')}</th>
                <th>{t('schedules.nextDue')}</th>
                <th class="sched-actions-col" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} class="muted sched-empty">{t('schedules.none')}</td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id} data-testid={`sched-row-${s.id}`}>
                    <td>
                      <span class="sched-mapping-name">{mappingNameById.get(s.mappingId) ?? s.mappingId}</span>{' '}
                      <span class="badge">{s.mode}</span>
                    </td>
                    <td>{s.periodType}</td>
                    <td>{s.eventDriven ? '✓' : '—'}</td>
                    <td>
                      {s.enabled ? <span class="badge badge-on">{t('schedules.on')}</span> : <span class="badge">{t('schedules.off')}</span>}
                    </td>
                    <td class="muted">{s.nextDueAt ? new Date(s.nextDueAt).toLocaleString() : '—'}</td>
                    <td>
                      <div class="sched-row-actions">
                        <button
                          type="button"
                          class="link"
                          data-testid={`toggle-${s.id}`}
                          onClick={() => void onToggle(s)}
                        >
                          {s.enabled ? t('schedules.disable') : t('schedules.enable')}
                        </button>
                        <button
                          type="button"
                          class="link sched-del"
                          data-testid={`del-${s.id}`}
                          onClick={() => setPendingDelete(s)}
                        >
                          {t('schedules.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}

      {pendingDelete && (
        <div class="sched-confirm-overlay" role="dialog" aria-modal="true">
          <div class="sched-confirm">
            <p class="sched-confirm-title">{t('schedules.deleteTitle')}</p>
            <p class="muted">
              {t('schedules.deleteBody', {
                mapping: mappingNameById.get(pendingDelete.mappingId) ?? pendingDelete.mappingId,
              })}
            </p>
            <div class="sched-confirm-actions">
              <button type="button" class="link" onClick={() => setPendingDelete(null)}>
                {t('schedules.cancel')}
              </button>
              <button
                type="button"
                class="btn sched-confirm-del"
                data-testid="confirm-delete"
                onClick={() => void doDelete()}
              >
                {t('schedules.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
