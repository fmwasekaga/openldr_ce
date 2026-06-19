import type { FormSection } from '@openldr/forms/pure';

export function SectionRow({ section, children }: { section: FormSection; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">{section.title.en}</div>
      <div className="divide-y divide-border">
        {section.fields.length === 0 ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No fields in this section.</div> : null}
        {children}
      </div>
    </section>
  );
}
