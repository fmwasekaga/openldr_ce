import { Routes, Route } from 'react-router-dom';
import { AppShell } from './shell/AppShell';

function Placeholder({ title }: { title: string }) {
  return <AppShell title={title}><div className="card">{title} — coming in the next task.</div></AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder title="Dashboard" />} />
      <Route path="/reports" element={<Placeholder title="Reports" />} />
      <Route path="/reports/:id" element={<Placeholder title="Report" />} />
      <Route path="*" element={<Placeholder title="Not found" />} />
    </Routes>
  );
}
