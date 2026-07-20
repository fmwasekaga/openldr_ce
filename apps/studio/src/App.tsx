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
import { SettingsShell } from '@/pages/settings/SettingsShell';
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
import { RequireRole } from './auth/RequireRole';
import { CallbackPage } from './auth/CallbackPage';
import { Toaster } from './components/ui/sonner';

export function App() {
  return (
    <>
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/" element={<DashboardPage />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/workflows" element={<RequireRole roles={['lab_admin', 'lab_manager']}><WorkflowList /></RequireRole>} />
      <Route path="/workflows/new" element={<RequireRole roles={['lab_admin', 'lab_manager']}><Workflows /></RequireRole>} />
      <Route path="/workflows/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><Workflows /></RequireRole>} />
      <Route path="/query" element={<RequireRole roles={['lab_admin', 'lab_manager', 'data_analyst']}><QueryPage /></RequireRole>} />
      <Route path="/terminology" element={<Terminology />} />
      <Route path="/users" element={<RequireRole role="lab_admin"><Users /></RequireRole>} />
      {/* Sites moved under Settings (was top-level /sites) so it isn't confused with a future
          Facilities / master facility list. The old path redirects so existing links keep working. */}
      <Route path="/sites" element={<Navigate to="/settings/sites" replace />} />
      <Route path="/settings" element={<RequireRole><SettingsShell /></RequireRole>}>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<RequireRole><General /></RequireRole>} />
        <Route path="notifications" element={<RequireRole roles={['lab_admin', 'lab_manager', 'data_analyst', 'system_auditor']}><NotificationPreferences /></RequireRole>} />
        <Route path="sites" element={<RequireRole role="lab_admin"><Sites /></RequireRole>} />
        <Route path="sync" element={<RequireRole role="lab_admin"><DistributedSync /></RequireRole>} />
        <Route path="marketplace" element={<RequireRole role="lab_admin"><Marketplace /></RequireRole>} />
        <Route path="connectors" element={<RequireRole role="lab_admin"><Connectors /></RequireRole>} />
      </Route>
      <Route path="/audit" element={<Audit />} />
      <Route path="/activity" element={<Activity />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/forms" element={<Forms />} />
      <Route path="/forms/new" element={<FormBuilderPage />} />
      <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
      <Route path="/report-designer" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportDesignerPage /></RequireRole>} />
      <Route path="/report-designer/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportDesignerPage /></RequireRole>} />
      <Route path="/forms/:id" element={<FormCapture />} />
      <Route path="/x/:pluginId" element={<RequireRole><PluginContainer /></RequireRole>} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:slug" element={<Docs />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
    <Toaster />
    </>
  );
}
