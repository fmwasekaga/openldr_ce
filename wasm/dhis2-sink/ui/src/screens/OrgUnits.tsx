import { useEffect, useMemo, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { Picker } from '../components/Picker';
import { t } from '../i18n';

/** A facility from `fhir.facilities()` ({ id, name }). */
interface Facility {
  id: string;
  name?: string;
}

/** An existing org-unit map doc as stored in the `orgUnitMaps` collection. */
interface OrgUnitMapDoc {
  facilityId: string;
  orgUnitId: string;
  orgUnitName?: string | null;
}

/** A single org unit from the cached DHIS2 metadata catalog. */
interface OrgUnit {
  id: string;
  name: string;
}

/** The per-facility row view model the table renders. */
interface FacilityRow {
  facilityId: string;
  facilityName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function OrgUnits() {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    const o = getOpenldr();
    const [facilitiesRaw, mapsRaw, cached] = await Promise.all([
      o.fhir.facilities(),
      o.storage.list('orgUnitMaps'),
      o.storage.get('metadataCache', 'latest'),
    ]);

    const facilities = asArray<Facility>(facilitiesRaw);
    const maps = asArray<{ doc: OrgUnitMapDoc }>(mapsRaw).map((e) => e.doc);
    const byFacility = new Map(maps.map((m) => [m.facilityId, m]));

    const metaCache = cached as { metadata?: { orgUnits?: unknown[] }; pulledAt?: string } | null;
    setOrgUnits(asArray<OrgUnit>(metaCache?.metadata?.orgUnits));
    setPulledAt(metaCache?.pulledAt ?? null);

    setRows(
      facilities.map((f) => {
        const m = byFacility.get(f.id);
        return {
          facilityId: f.id,
          facilityName: f.name ?? f.id,
          orgUnitId: m?.orgUnitId ?? null,
          orgUnitName: m?.orgUnitName ?? null,
        };
      }),
    );
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

  const options = useMemo(() => orgUnits.map((o) => ({ value: o.id, label: o.name })), [orgUnits]);
  const catalogEmpty = orgUnits.length === 0;

  async function onPick(facilityId: string, orgUnitId: string) {
    const ou = orgUnits.find((o) => o.id === orgUnitId);
    try {
      await getOpenldr().storage.put('orgUnitMaps', facilityId, {
        facilityId,
        orgUnitId,
        orgUnitName: ou?.name ?? null,
      });
      setToast({ kind: 'ok', text: t('orgUnits.mappedToast', { facility: facilityId }) });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onClear(facilityId: string) {
    try {
      await getOpenldr().storage.delete('orgUnitMaps', facilityId);
      setToast({ kind: 'ok', text: t('orgUnits.clearedToast', { facility: facilityId }) });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div class="dhis2" data-testid="dhis2-orgunits-page">
      <h1>{t('orgUnits.title')}</h1>

      <p class="muted orgunits-pulled">
        {pulledAt
          ? t('orgUnits.pulledAt', { when: new Date(pulledAt).toLocaleString() })
          : t('orgUnits.neverPulled')}
      </p>

      {phase.phase === 'loading' && <p class="status muted">{t('common.loading')}</p>}
      {phase.phase === 'error' && <div class="error" role="alert">{phase.message}</div>}

      {toast && (
        <div class={toast.kind === 'ok' ? 'toast toast-ok' : 'toast toast-err'} role="status">
          {toast.text}
        </div>
      )}

      {phase.phase === 'ready' && (
        <table class="table orgunits-table">
          <thead>
            <tr>
              <th>{t('orgUnits.facility')}</th>
              <th>{t('orgUnits.orgUnit')}</th>
              <th class="orgunits-actions-col" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} class="muted orgunits-empty">{t('orgUnits.noFacilities')}</td>
              </tr>
            ) : (
              rows.map((f) => (
                <tr key={f.facilityId} data-testid={`orgunit-row-${f.facilityId}`}>
                  <td>
                    <div class="orgunits-facility-name">{f.facilityName}</div>
                    <div class="muted orgunits-facility-id">{f.facilityId}</div>
                  </td>
                  <td>
                    {f.orgUnitId ? (
                      <span>
                        {f.orgUnitName ?? f.orgUnitId}{' '}
                        <span class="muted">({f.orgUnitId})</span>
                      </span>
                    ) : (
                      <span class="badge">{t('orgUnits.unmapped')}</span>
                    )}
                  </td>
                  <td>
                    <div class="orgunits-row-actions">
                      <div class="orgunits-picker">
                        <Picker
                          options={options}
                          value={f.orgUnitId}
                          onChange={(v) => void onPick(f.facilityId, v)}
                          placeholder={t('orgUnits.pickOrgUnit')}
                          searchPlaceholder={t('orgUnits.searchOrgUnits')}
                          disabled={catalogEmpty}
                          testId={`orgunit-picker-${f.facilityId}`}
                        />
                      </div>
                      {f.orgUnitId && (
                        <button
                          type="button"
                          class="link"
                          onClick={() => void onClear(f.facilityId)}
                        >
                          {t('orgUnits.clear')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
