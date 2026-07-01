import { Card } from '@/components/ui/card';

const FEATURES = [
  { title: 'Ingestion', body: 'HL7v2, CSV/Excel, and WHONET via pluggable converters.' },
  { title: 'Workflows', body: 'A visual node builder for transform, route, and report pipelines.' },
  { title: 'Forms', body: 'Build and run FHIR-backed data-collection forms.' },
  { title: 'DHIS2', body: 'Push aggregate and tracker data to DHIS2 as a sink plugin.' },
  { title: 'Reports', body: 'Scheduled SQL → Excel-template → email report pipelines.' },
  { title: 'Extensible', body: 'Signed, capability-scoped plugins with their own UI and data.' },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-5">
            <h3 className="mb-1 text-base font-medium">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
