import { useEffect, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { t } from '../i18n';

/** Connector record as exposed by the host `connectors.list()` (secrets masked).
    Mirrors apps/web api `Connector` — `allowedHost` is the host field. */
interface Connector {
  id: string;
  name: string;
  kind?: string;
  allowedHost?: string | null;
  enabled?: boolean;
}

/** Raw metadata arrays returned by `connectors.metadata(id)` (host pullMetadata). */
interface RawMetadata {
  dataElements?: unknown[];
  orgUnits?: unknown[];
  categoryOptionCombos?: unknown[];
  programs?: unknown[];
  programStages?: unknown[];
}

/** Counts derived from the cached/pulled metadata arrays. */
interface MetadataCounts {
  dataElements: number;
  orgUnits: number;
  categoryOptionCombos: number;
  programs: number;
  programStages: number;
}

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

function counts(md: RawMetadata | null | undefined): MetadataCounts {
  return {
    dataElements: md?.dataElements?.length ?? 0,
    orgUnits: md?.orgUnits?.length ?? 0,
    categoryOptionCombos: md?.categoryOptionCombos?.length ?? 0,
    programs: md?.programs?.length ?? 0,
    programStages: md?.programStages?.length ?? 0,
  };
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function Dashboard({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [active, setActive] = useState<Connector | null>(null);
  const [meta, setMeta] = useState<MetadataCounts | null>(null);
  const [pushes, setPushes] = useState<PushDoc[]>([]);
  const [mappingCount, setMappingCount] = useState(0);
  const [orgUnitCount, setOrgUnitCount] = useState(0);
  const [scheduleCount, setScheduleCount] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = getOpenldr();
        await o.ready;
        const [connectorsRaw, cached, pushesRaw, mappings, orgUnits, schedules] = await Promise.all([
          o.connectors.list(),
          o.storage.get('metadataCache', 'latest'),
          o.storage.list('pushes'),
          o.storage.list('mappings'),
          o.storage.list('orgUnitMaps'),
          o.storage.list('schedules'),
        ]);
        if (!alive) return;
        const connectors = asArray<Connector>(connectorsRaw);
        // Only DHIS2 connectors (kind 'sink') are relevant here — never the host's
        // Postgres warehouse (kind 'database'), which would otherwise show up as the
        // "active connector" on a fresh install where it's the only enabled connector.
        setActive(connectors.find((c) => c.enabled && c.kind === 'sink') ?? null);
        const cachedMeta = (cached as { metadata?: RawMetadata } | null)?.metadata ?? null;
        setMeta(cachedMeta ? counts(cachedMeta) : null);
        setPushes(
          asArray<{ doc: PushDoc }>(pushesRaw)
            .map((e) => e.doc)
            .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
            .slice(0, 10),
        );
        setMappingCount(asArray(mappings).length);
        setOrgUnitCount(asArray(orgUnits).length);
        setScheduleCount(asArray(schedules).length);
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

  async function doPull() {
    if (!active) return;
    setPulling(true);
    setPullError(null);
    try {
      const o = getOpenldr();
      const md = (await o.connectors.metadata(active.id)) as RawMetadata;
      const pulledAt = new Date().toISOString();
      await o.storage.put('metadataCache', 'latest', { metadata: md, pulledAt });
      setMeta(counts(md));
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  }

  const configured = !!active;

  return (
    <div class="dhis2" data-testid="dhis2-dashboard">
      <h1>{t('dashboard.title')}</h1>

      {phase.phase === 'loading' && <p class="status muted">{t('common.loading')}</p>}
      {phase.phase === 'error' && <div class="error" role="alert">{phase.message}</div>}

      {phase.phase === 'ready' && (
        <div class="cards">
          {/* Active connector */}
          <section class="card" data-testid="active-connector">
            <h2>{t('dashboard.activeConnector')}</h2>
            <div class="badges">
              <span class={`badge ${configured ? 'badge-on' : ''}`}>
                {configured ? t('dashboard.configured') : t('dashboard.notConfigured')}
              </span>
            </div>
            {configured ? (
              <dl class="kv">
                <div><dt>{t('dashboard.name')}</dt><dd>{active?.name ?? '-'}</dd></div>
                <div><dt>{t('dashboard.host')}</dt><dd>{active?.allowedHost ?? '-'}</dd></div>
              </dl>
            ) : (
              <p class="muted">
                {t('dashboard.noConnector')}
              </p>
            )}
          </section>

          {/* Metadata */}
          <section class="card" data-testid="metadata-card">
            <h2>{t('dashboard.metadata')}</h2>
            <button
              type="button"
              class="btn"
              onClick={() => void doPull()}
              disabled={!configured || pulling}
              data-testid="dhis2-pull-metadata"
            >
              {pulling ? t('dashboard.pulling') : t('dashboard.pullMetadata')}
            </button>
            {pullError && <p class="error-text" role="alert">{pullError}</p>}
            {meta ? (
              <dl class="counts" data-testid="metadata-counts">
                {([
                  [t('dashboard.dataElements'), meta.dataElements],
                  [t('dashboard.orgUnits'), meta.orgUnits],
                  [t('dashboard.categoryOptionCombos'), meta.categoryOptionCombos],
                  [t('dashboard.programs'), meta.programs],
                  [t('dashboard.programStages'), meta.programStages],
                ] as const).map(([label, n]) => (
                  <div key={label}><dt>{label}</dt><dd>{n}</dd></div>
                ))}
              </dl>
            ) : (
              <p class="muted">{t('dashboard.noMetadata')}</p>
            )}
          </section>

          {/* Overview */}
          <section class="card" data-testid="overview-card">
            <h2>{t('dashboard.overview')}</h2>
            <div class="overview-counts">
              <div>
                <span class="muted">{t('dashboard.mappings')}</span>{mappingCount}{' '}
                <button type="button" class="link" onClick={() => onNavigate?.('mappings')} data-testid="manage-mappings">{t('dashboard.manage')}</button>
              </div>
              <div>
                <span class="muted">{t('dashboard.orgUnitMappings')}</span>{orgUnitCount}{' '}
                <button type="button" class="link" onClick={() => onNavigate?.('orgUnits')} data-testid="manage-orgunits">{t('dashboard.manage')}</button>
              </div>
              <div>
                <span class="muted">{t('dashboard.schedules')}</span>{scheduleCount}{' '}
                <button type="button" class="link" onClick={() => onNavigate?.('schedules')} data-testid="manage-schedules">{t('dashboard.manage')}</button>
              </div>
            </div>

            <div class="recent">
              <div class="recent-head">
                <span class="recent-title">{t('dashboard.recentPushes')}</span>
                <button type="button" class="link" onClick={() => onNavigate?.('pushes')} data-testid="view-all-pushes">{t('dashboard.viewAll')}</button>
              </div>
              {pushes.length === 0 ? (
                <p class="muted">{t('dashboard.noPushes')}</p>
              ) : (
                <table class="table" data-testid="recent-pushes">
                  <thead>
                    <tr><th>{t('dashboard.when')}</th><th>{t('dashboard.status')}</th><th>{t('dashboard.kindPeriod')}</th></tr>
                  </thead>
                  <tbody>
                    {pushes.map((p, i) => (
                      <tr key={p.id ?? i}>
                        <td class="muted">{p.at ? new Date(p.at).toLocaleString() : '-'}</td>
                        <td>{p.status ?? '-'}</td>
                        <td>{[p.kind, p.period].filter(Boolean).join(' · ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
