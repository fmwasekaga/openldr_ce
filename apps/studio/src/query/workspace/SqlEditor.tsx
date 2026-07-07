// apps/studio/src/query/workspace/SqlEditor.tsx
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';

export function SqlEditor({ value, onChange, onRun }: { value: string; onChange(v: string): void; onRun(): void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const onRunRef = useRef(onRun); onRunRef.current = onRun;

  useEffect(() => {
    if (!host.current || view.current) return;
    try {
      view.current = new EditorView({
        parent: host.current, doc: value,
        extensions: [
          basicSetup, sqlLang(),
          EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-content': { fontFamily: 'var(--mono)' } }),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
          EditorView.domEventHandlers({ keydown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRunRef.current(); return true; }
            return false;
          } }),
        ],
      });
    } catch { /* jsdom */ }
    return () => { view.current?.destroy(); view.current = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
      <textarea aria-label="SQL" className="sr-only" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
