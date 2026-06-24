import { useEffect, useState } from 'preact/hooks';
import { getOpenldr } from './sdk';

type Status =
  | { phase: 'loading' }
  | { phase: 'ready'; connectors: number }
  | { phase: 'error'; message: string };

/** Trivial first screen — proves the SPA + host handshake pipeline end-to-end.
    Real screens (dashboard, mappings, schedules, ...) replace this in Tasks 6-11. */
export function App() {
  const [status, setStatus] = useState<Status>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const openldr = getOpenldr();
        await openldr.ready;
        const list = await openldr.connectors.list();
        const count = Array.isArray(list) ? list.length : 0;
        if (alive) setStatus({ phase: 'ready', connectors: count });
      } catch (e) {
        if (alive) setStatus({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        // Signal SDK handshake complete + first data settled (success OR error) so the
        // host/e2e can await a real readiness signal — not merely first paint. Body is
        // global, so set it unconditionally once init settles even if we've unmounted.
        document.body.setAttribute('data-openldr-ready', '1');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div class="dhis2">
      <h1>DHIS2</h1>
      {status.phase === 'loading' && <p class="status muted">Loading…</p>}
      {status.phase === 'ready' && (
        <p class="status">
          {status.connectors > 0
            ? `${status.connectors} connector${status.connectors === 1 ? '' : 's'} configured`
            : 'No connector configured'}
        </p>
      )}
      {status.phase === 'error' && <p class="status">Error: {status.message}</p>}
    </div>
  );
}
