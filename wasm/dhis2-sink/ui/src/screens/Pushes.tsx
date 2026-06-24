import { useEffect, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { t } from '../i18n';

/** A push doc as written by the orchestration into the `pushes` collection. */
interface PushDoc {
  id?: string;
  period?: string;
  kind?: string;
  connectorId?: string;
  status?: string;
  imported?: number;
  updated?: number;
  ignored?: number;
  conflicts?: number;
  skipped?: number;
  count?: number;
  at?: string;
  trigger?: string;
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Format an ISO `at` timestamp; fall back to the raw value (or —) on a bad date. */
function formatWhen(at: string | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
}

/** Compact result summary, e.g. "12 imp · 3 upd · 0 conf" (+ "· 1 skip" when skipped). */
function formatResult(p: PushDoc): string {
  const parts = [
    `${p.imported ?? 0} imp`,
    `${p.updated ?? 0} upd`,
    `${p.conflicts ?? 0} conf`,
  ];
  if ((p.skipped ?? 0) > 0) parts.push(`${p.skipped} skip`);
  return parts.join(' · ');
}

export function Pushes() {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [pushes, setPushes] = useState<PushDoc[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = getOpenldr();
        await o.ready;
        const raw = await o.storage.list('pushes');
        if (!alive) return;
        setPushes(
          asArray<{ doc: PushDoc }>(raw)
            .map((e) => e.doc)
            .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
        );
        setPhase({ phase: 'ready' });
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

  return (
    <div class="dhis2" data-testid="dhis2-pushes-page">
      <h1>{t('pushes.title')}</h1>

      {phase.phase === 'loading' && <p class="status muted">{t('common.loading')}</p>}
      {phase.phase === 'error' && <div class="error" role="alert">{phase.message}</div>}

      {phase.phase === 'ready' &&
        (pushes.length === 0 ? (
          <p class="muted">{t('pushes.noPushes')}</p>
        ) : (
          <table class="table" data-testid="pushes-table">
            <thead>
              <tr>
                <th>{t('pushes.when')}</th>
                <th>{t('pushes.kind')}</th>
                <th>{t('pushes.period')}</th>
                <th>{t('pushes.status')}</th>
                <th>{t('pushes.result')}</th>
                <th>{t('pushes.trigger')}</th>
              </tr>
            </thead>
            <tbody>
              {pushes.map((p, i) => (
                <tr key={p.id ?? i}>
                  <td class="muted">{formatWhen(p.at)}</td>
                  <td>{p.kind ?? '—'}</td>
                  <td>{p.period ?? '—'}</td>
                  <td>{p.status ?? '—'}</td>
                  <td>{formatResult(p)}</td>
                  <td>{p.trigger ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
