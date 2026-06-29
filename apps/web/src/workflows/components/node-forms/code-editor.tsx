import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { cn } from '@/lib/cn';

type Lang = 'javascript' | 'json' | 'sql';

function langExt(language: Lang) {
  if (language === 'javascript') return javascript();
  if (language === 'json') return json();
  return sql();
}

/**
 * Controlled CodeMirror 6 wrapper. We deliberately use CodeMirror (not Monaco)
 * for the node-config side panel — it's lightweight enough to live inline.
 *
 * The view is recreated only when `language`/`readOnly` change. External `value`
 * is synced via a transaction in a separate effect, but only when it differs
 * from the current doc, to avoid feedback loops with `onChange`.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  minHeight = '14rem',
  readOnly = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  language: Lang;
  placeholder?: string;
  minHeight?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          // basicSetup bundles lineNumbers/history/bracketMatching/closeBrackets/
          // indentOnInput/highlightActiveLine plus the default + history keymaps.
          basicSetup,
          langExt(language),
          oneDark,
          EditorView.lineWrapping,
          EditorView.editable.of(!readOnly),
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { fontSize: '12px', minHeight },
            '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-scroller': { overflow: 'auto' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when language/readOnly change; value is synced in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={host}
      className={cn(
        'overflow-hidden rounded-md border border-border bg-background/40 [&_.cm-editor]:max-h-[60vh]',
        className,
      )}
    />
  );
}
