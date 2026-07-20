import { ScreenshotFrame } from './ScreenshotFrame';
import type { PublicScreenshotName } from '@/landing/screenshots';

interface FeatureSection {
  title: string;
  eyebrow: string;
  body: string;
  image: PublicScreenshotName;
  imageAlt: string;
  points: [string, string, string];
}

const FEATURES: FeatureSection[] = [
  {
    title: 'Workflows',
    eyebrow: 'Build pipelines visually',
    body: 'Create repeatable data flows for ingestion, transformation, routing, and reporting without hiding the operational details.',
    image: 'workflow-builder.png',
    imageAlt: 'OpenLDR workflow builder',
    points: ['Node-based builder', 'Run history and inspection', 'Plugin-backed steps'],
  },
  {
    title: 'Reports',
    eyebrow: 'Turn lab data into outputs',
    body: 'Run reports from curated definitions, review results, and export the formats teams already use.',
    image: 'reports-run-result.png',
    imageAlt: 'OpenLDR report run result',
    points: ['Parameterized runs', 'Spreadsheet output', 'Scheduled delivery paths'],
  },
  {
    title: 'Forms',
    eyebrow: 'Capture structured data',
    body: 'Design and publish FHIR-backed forms for workflows that need consistent, governed data entry.',
    image: 'form-builder.png',
    imageAlt: 'OpenLDR form builder',
    points: ['Builder and capture views', 'Terminology-aware fields', 'Lifecycle controls'],
  },
  {
    title: 'Query and report design',
    eyebrow: 'Bridge exploration and templates',
    body: 'Explore connected data, save reusable queries, and bind them into printable report templates.',
    image: 'query-workbench.png',
    imageAlt: 'OpenLDR query workbench',
    points: ['Connector explorer', 'Saved SQL queries', 'Report template binding'],
  },
  {
    title: 'Sync and administration',
    eyebrow: 'Run across real deployments',
    body: 'Enroll sites, configure distributed sync, manage connectors, and keep operational activity visible.',
    image: 'sync-settings-card.png',
    imageAlt: 'OpenLDR distributed sync settings',
    points: ['Site enrollment', 'Connector settings', 'Audit-oriented operations'],
  },
];

export function FeatureWalkthrough() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16" aria-labelledby="features-heading">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase text-primary">Studio capabilities</p>
        <h2 id="features-heading" className="mt-2 text-2xl font-semibold">
          The pieces you need, shown directly.
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          OpenLDR is meant for teams managing laboratory data pipelines, reporting, forms, and operations from one self-hosted workspace.
        </p>
      </div>
      <div className="space-y-14">
        {FEATURES.map((feature, index) => (
          <section
            key={feature.title}
            aria-label={feature.title}
            className="grid items-center gap-6 border-t border-border pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]"
          >
            <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
              <p className="text-xs font-semibold uppercase text-primary">{feature.eyebrow}</p>
              <h3 className="mt-2 text-xl font-semibold">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.body}</p>
              <ul className="mt-4 grid gap-2 text-sm text-foreground sm:grid-cols-3 lg:grid-cols-1">
                {feature.points.map((point) => (
                  <li key={point} className="rounded-md border border-border bg-card px-3 py-2">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <ScreenshotFrame
              name={feature.image}
              alt={feature.imageAlt}
              caption={feature.title}
              className={index % 2 === 1 ? 'lg:order-1' : undefined}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
