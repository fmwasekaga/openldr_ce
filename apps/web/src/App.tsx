import { Routes, Route } from 'react-router-dom';
import { Reports } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { Terminology } from './pages/Terminology';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';
import { Audit } from './pages/Audit';
import { Users } from './pages/Users';
import { Dhis2 } from '@/pages/Dhis2';
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
      <Route path="/dhis2" element={<RequireRole role="lab_admin"><Dhis2 /></RequireRole>} />
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
