import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScreenshotFrame } from './ScreenshotFrame';

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] lg:py-20">
      <div>
        <p className="text-xs font-semibold uppercase text-primary">Open laboratory data repository</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">OpenLDR</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          Self-hosted laboratory data ingestion, workflows, forms, reports, and distributed sync for teams that need operational control.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href="#install">
              Get started
              <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/docs">
              <BookOpen className="h-4 w-4" />
              Read the docs
            </Link>
          </Button>
        </div>
      </div>
      <ScreenshotFrame
        name="dashboard-overview.png"
        alt="OpenLDR dashboard overview"
        caption="Studio dashboard overview"
        priority
      />
    </section>
  );
}
