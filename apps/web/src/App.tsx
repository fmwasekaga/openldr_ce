import { Routes, Route, Navigate } from 'react-router-dom';
import { Reports } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { Terminology } from './pages/Terminology';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';
import { Audit } from './pages/Audit';
import { Users } from './pages/Users';
import { Dhis2 } from '@/pages/Dhis2';
import { Dhis2OrgUnits } from '@/pages/Dhis2OrgUnits';
import { Dhis2Mappings } from '@/pages/Dhis2Mappings';
import { Dhis2MappingEditor } from '@/pages/Dhis2MappingEditor';
import { Dhis2Schedules } from '@/pages/Dhis2Schedules';
import { Dhis2Pushes } from '@/pages/Dhis2Pushes';
import { SettingsShell } from '@/pages/settings/SettingsShell';
import { Dhis2Redirect } from '@/pages/settings/Dhis2Redirect';
import { Forms } from './pages/Forms';
import { FormCapture } from './pages/FormCapture';
import { FormBuilderPage } from './forms-builder/FormBuilderPage';
import { RequireRole } from './auth/RequireRole';
import { CallbackPage } from './auth/CallbackPage';

export function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/" element={<DashboardPage />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/reports/:id" element={<ReportDetail />} />
      <Route path="/terminology" element={<Terminology />} />
      <Route path="/users" element={<RequireRole role="lab_admin"><Users /></RequireRole>} />
      <Route path="/settings" element={<SettingsShell />}>
        <Route index element={<Navigate to="dhis2" replace />} />
        <Route path="dhis2" element={<RequireRole role="lab_admin"><Dhis2 /></RequireRole>} />
        <Route path="dhis2/orgunits" element={<RequireRole role="lab_admin"><Dhis2OrgUnits /></RequireRole>} />
        <Route path="dhis2/mappings" element={<RequireRole role="lab_admin"><Dhis2Mappings /></RequireRole>} />
        <Route path="dhis2/mappings/new" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
        <Route path="dhis2/mappings/:id" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
        <Route path="dhis2/schedules" element={<RequireRole role="lab_admin"><Dhis2Schedules /></RequireRole>} />
        <Route path="dhis2/pushes" element={<RequireRole role="lab_admin"><Dhis2Pushes /></RequireRole>} />
      </Route>
      <Route path="/dhis2/*" element={<Dhis2Redirect />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/forms" element={<Forms />} />
      <Route path="/forms/new" element={<FormBuilderPage />} />
      <Route path="/forms/:id/builder" element={<FormBuilderPage />} />
      <Route path="/forms/:id" element={<FormCapture />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:slug" element={<Docs />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
  );
}
