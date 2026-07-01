import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { WidgetQuery } from '../../api';

type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;

export function SqlForm({ value, onChange }: { value: SqlQuery; onChange: (q: SqlQuery) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  useEffect(() => {
    if (!host.current || view.current) return;
    try {
      view.current = new EditorView({
        parent: host.current,
        doc: value.sql,
        extensions: [
          basicSetup,
          sqlLang(),
          oneDark,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange({ mode: 'sql', sql: u.state.doc.toString() });
          }),
        ],
      });
    } catch {
      // CodeMirror may fail to initialise in jsdom; the sr-only textarea covers that path.
    }
    return () => { view.current?.destroy(); view.current = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <div ref={host} className="overflow-hidden rounded border border-border" />
      {/* Accessible/testable mirror; one-way bound for screen readers and tests. */}
      <textarea
        aria-label="SQL"
        className="sr-only"
        value={value.sql}
        onChange={(e) => onChange({ mode: 'sql', sql: e.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        Read-only SELECT/WITH only. Use {'{{'}variable{'}}'} for dashboard filters.
      </p>
    </div>
  );
}
