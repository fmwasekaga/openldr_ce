import { Routes, Route } from 'react-router-dom';
import { Reports } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { Terminology } from './pages/Terminology';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';
import { Audit } from './pages/Audit';
import { Users } from './pages/Users';
import { Forms } from './pages/Forms';
import { FormCapture } from './pages/FormCapture';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/reports/:id" element={<ReportDetail />} />
      <Route path="/terminology" element={<Terminology />} />
      <Route path="/users" element={<Users />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/forms" element={<Forms />} />
      <Route path="/forms/:id" element={<FormCapture />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:slug" element={<Docs />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
  );
}
