import { useState } from 'preact/hooks';
import { Dashboard } from './screens/Dashboard';
import { Mappings } from './screens/Mappings';
import { Schedules } from './screens/Schedules';
import { OrgUnits } from './screens/OrgUnits';
import { Pushes } from './screens/Pushes';
import { MappingEditor } from './screens/MappingEditor';
import { t } from './i18n';

/**
 * Screen routing for the sandboxed iframe — a plain state union, no react-router
 * (the SPA is a single page inside the host's webview). `editor` is reached only
 * from the Mappings list (it is not a top-nav tab); every other screen is a tab.
 */
type Route =
  | { screen: 'dashboard' }
  | { screen: 'mappings' }
  | { screen: 'schedules' }
  | { screen: 'orgUnits' }
  | { screen: 'pushes' }
  | { screen: 'editor'; mappingId?: string };

/** Top-nav tabs, in order. The editor is intentionally absent (list-only entry).
    The `labelKey` resolves through i18n at render time. */
const TABS: ReadonlyArray<{ screen: Exclude<Route['screen'], 'editor'>; labelKey: string }> = [
  { screen: 'dashboard', labelKey: 'nav.dashboard' },
  { screen: 'mappings', labelKey: 'nav.mappings' },
  { screen: 'schedules', labelKey: 'nav.schedules' },
  { screen: 'orgUnits', labelKey: 'nav.orgUnits' },
  { screen: 'pushes', labelKey: 'nav.pushes' },
];

/**
 * The DHIS2 plugin shell — a top-nav bar + the active screen. The shell renders
 * synchronously (no blank frame); each mounted screen awaits `openldr.ready`
 * itself and sets `data-openldr-ready` once its first load settles.
 */
export function App() {
  const [route, setRoute] = useState<Route>({ screen: 'dashboard' });

  // The Mappings/Dashboard editor entry collapses to this single route. The
  // "active" tab for the editor stays on Mappings (it's a sub-screen of it).
  const activeTab = route.screen === 'editor' ? 'mappings' : route.screen;

  return (
    <div class="dhis2-shell">
      <nav class="dhis2-nav" data-testid="dhis2-nav">
        {TABS.map((tab) => (
          <button
            key={tab.screen}
            type="button"
            class={`dhis2-tab${activeTab === tab.screen ? ' dhis2-tab-active' : ''}`}
            data-testid={`nav-${tab.screen}`}
            aria-current={activeTab === tab.screen ? 'page' : undefined}
            onClick={() => setRoute({ screen: tab.screen })}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

      <main class="dhis2-screen">
        {route.screen === 'dashboard' && (
          <Dashboard
            onNavigate={(s) => {
              // Dashboard emits 'mappings' | 'orgUnits' | 'schedules' | 'pushes'.
              if (s === 'mappings' || s === 'orgUnits' || s === 'schedules' || s === 'pushes') {
                setRoute({ screen: s });
              }
            }}
          />
        )}
        {route.screen === 'mappings' && (
          <Mappings
            onNavigate={(s, id) => {
              // Mappings emits 'new' (create) | 'edit' (with id).
              if (s === 'new') setRoute({ screen: 'editor' });
              else if (s === 'edit') setRoute({ screen: 'editor', mappingId: id });
            }}
          />
        )}
        {route.screen === 'schedules' && <Schedules />}
        {route.screen === 'orgUnits' && <OrgUnits />}
        {route.screen === 'pushes' && <Pushes />}
        {route.screen === 'editor' && (
          <MappingEditor mappingId={route.mappingId} onDone={() => setRoute({ screen: 'mappings' })} />
        )}
      </main>
    </div>
  );
}
