import { Routes, Route, Navigate } from 'react-router-dom';
import { Reports } from './pages/Reports';
import { Terminology } from './pages/Terminology';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';
import { Audit } from './pages/Audit';
import { Activity } from './pages/Activity';
import { Users } from './pages/Users';
import { SettingsShell } from '@/pages/settings/SettingsShell';
import { General } from '@/pages/settings/General';
import { Marketplace } from '@/pages/settings/Marketplace';
import { Connectors } from '@/pages/settings/Connectors';
import { Forms } from './pages/Forms';
import { FormCapture } from './pages/FormCapture';
import { FormBuilderPage } from './forms-builder/FormBuilderPage';
import { ReportBuilderPage } from './reports-builder/ReportBuilderPage';
import { Workflows } from './workflows/page';
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
      <Route path="/terminology" element={<Terminology />} />
      <Route path="/users" element={<RequireRole role="lab_admin"><Users /></RequireRole>} />
      <Route path="/settings" element={<RequireRole><SettingsShell /></RequireRole>}>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<RequireRole><General /></RequireRole>} />
        <Route path="marketplace" element={<RequireRole role="lab_admin"><Marketplace /></RequireRole>} />
        <Route path="connectors" element={<RequireRole role="lab_admin"><Connectors /></RequireRole>} />
      </Route>
      <Route path="/audit" element={<Audit />} />
      <Route path="/activity" element={<Activity />} />
      <Route path="/forms" element={<Forms />} />
      <Route path="/forms/new" element={<FormBuilderPage />} />
      <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
      <Route path="/reports/builder/new" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportBuilderPage /></RequireRole>} />
      <Route path="/reports/builder/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportBuilderPage /></RequireRole>} />
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
