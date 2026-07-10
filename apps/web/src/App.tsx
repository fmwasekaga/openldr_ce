import { Routes, Route, Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { InstallBlock } from '@/components/InstallBlock';
import { Features } from '@/components/Features';
import { Footer } from '@/components/Footer';
import { DocsPage } from '@/docs/DocsPage';

function Landing() {
  return (
    <>
      <Hero />
      <InstallBlock />
      <Features />
    </>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link to="/" className="text-lg font-semibold text-foreground">OpenLDR</Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
          {/* Studio is a separate app served by the gateway under /studio/ — a full navigation, not a router Link. */}
          <a href="/studio/" className="text-muted-foreground hover:text-foreground">Studio</a>
          <a href="https://github.com/Open-Laboratory-Data-Repository/openldr" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:page" element={<DocsPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
