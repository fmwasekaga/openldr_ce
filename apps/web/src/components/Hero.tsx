import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="mb-4 text-4xl font-semibold tracking-tight">Open Laboratory Data Repository</h1>
      <p className="mb-8 text-lg text-muted-foreground">
        Ingest, transform, and report laboratory data. Self-hosted, extensible, open source.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Button asChild><a href="#install">Get started</a></Button>
        <Button asChild variant="secondary"><Link to="/docs">Read the docs</Link></Button>
      </div>
    </section>
  );
}
