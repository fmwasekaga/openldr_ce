import { Routes, Route, Navigate } from 'react-router-dom';
import { Reports } from './pages/Reports';
import { Terminology } from './pages/Terminology';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';
import { Audit } from './pages/Audit';
import { Activity } from './pages/Activity';
import { Notifications } from './pages/Notifications';
import { Users } from './pages/Users';
import { Sites } from './pages/settings/Sites';
import { SettingsShell, SettingsIndexRedirect } from '@/pages/settings/SettingsShell';
import { General } from '@/pages/settings/General';
import { NotificationPreferences } from '@/pages/settings/NotificationPreferences';
import { DistributedSync } from '@/pages/settings/DistributedSync';
import { Marketplace } from '@/pages/settings/Marketplace';
import { Connectors } from '@/pages/settings/Connectors';
import { Forms } from './pages/Forms';
import { FormCapture } from './pages/FormCapture';
import { FormBuilderPage } from './forms-builder/FormBuilderPage';
import { ReportDesignerPage } from './report-designer/ReportDesignerPage';
import { Workflows } from './workflows/page';
import { QueryPage } from './query/QueryPage';
import { WorkflowList } from './workflows/WorkflowList';
import { PluginContainer } from './plugins/PluginContainer';
import { RequireCapability } from './auth/RequireCapability';
import { Roles } from './pages/Roles';
import { CallbackPage } from './auth/CallbackPage';
import { Toaster } from './components/ui/sonner';

export function App() {
  return (
    <>
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/" element={<DashboardPage />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/workflows" element={<RequireCapability cap="workflows.view"><WorkflowList /></RequireCapability>} />
      <Route path="/workflows/new" element={<RequireCapability cap="workflows.view"><Workflows /></RequireCapability>} />
      <Route path="/workflows/:id" element={<RequireCapability cap="workflows.view"><Workflows /></RequireCapability>} />
      <Route path="/query" element={<RequireCapability cap="query.run"><QueryPage /></RequireCapability>} />
      <Route path="/terminology" element={<Terminology />} />
      <Route path="/users" element={<RequireCapability cap="users.view"><Users /></RequireCapability>} />
      {/* Sites moved under Settings (was top-level /sites) so it isn't confused with a future
          Facilities / master facility list. The old path redirects so existing links keep working. */}
      <Route path="/sites" element={<Navigate to="/settings/sites" replace />} />
      {/* Children are reached through this parent, so its gate must be an OR of every
          child sub-page's cap (kept in sync with SettingsShell's SUB_NAV) — not just
          settings.view — or a non-admin who can reach one sub-page (e.g. notifications.view)
          would be denied before ever getting to it. Each child route keeps its own,
          narrower cap below. */}
      <Route
        path="/settings"
        element={
          <RequireCapability
            caps={['settings.view', 'notifications.view', 'sync.view', 'sync.manage', 'marketplace.view', 'connectors.manage', 'roles.view']}
          >
            <SettingsShell />
          </RequireCapability>
        }
      >
        <Route index element={<SettingsIndexRedirect />} />
        <Route path="general" element={<RequireCapability cap="settings.view"><General /></RequireCapability>} />
        <Route path="notifications" element={<RequireCapability cap="notifications.view"><NotificationPreferences /></RequireCapability>} />
        <Route path="sites" element={<RequireCapability cap="sync.manage"><Sites /></RequireCapability>} />
        <Route path="sync" element={<RequireCapability cap="sync.view"><DistributedSync /></RequireCapability>} />
        <Route path="marketplace" element={<RequireCapability cap="marketplace.view"><Marketplace /></RequireCapability>} />
        <Route path="connectors" element={<RequireCapability cap="connectors.manage"><Connectors /></RequireCapability>} />
        <Route path="roles" element={<RequireCapability cap="roles.view"><Roles /></RequireCapability>} />
      </Route>
      <Route path="/audit" element={<Audit />} />
      <Route path="/activity" element={<Activity />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/forms" element={<Forms />} />
      <Route path="/forms/new" element={<FormBuilderPage />} />
      <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
      <Route path="/report-designer" element={<RequireCapability cap="reports.edit_templates"><ReportDesignerPage /></RequireCapability>} />
      <Route path="/report-designer/:id" element={<RequireCapability cap="reports.edit_templates"><ReportDesignerPage /></RequireCapability>} />
      <Route path="/forms/:id" element={<FormCapture />} />
      <Route path="/x/:pluginId" element={<RequireCapability><PluginContainer /></RequireCapability>} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:slug" element={<Docs />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
    <Toaster />
    </>
  );
}
