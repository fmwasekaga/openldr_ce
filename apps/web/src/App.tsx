import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ReportDetail } from './pages/ReportDetail';
import { Docs } from './pages/Docs';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './dashboard/DashboardPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/reports" element={<Dashboard />} />
      <Route path="/reports/:id" element={<ReportDetail />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:slug" element={<Docs />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
  );
}
