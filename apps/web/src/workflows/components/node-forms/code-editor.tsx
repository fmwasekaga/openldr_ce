import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
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

const readIsDark = () =>
  typeof document === 'undefined' || document.documentElement.getAttribute('data-theme') !== 'light';

/**
 * Track the app theme (the `data-theme` attribute on <html>, set by shell/useTheme),
 * reacting to live toggles. We observe the attribute directly rather than calling
 * useTheme() because that hook holds per-component state and wouldn't see a toggle
 * made elsewhere.
 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(readIsDark);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(readIsDark()));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    setIsDark(readIsDark()); // sync on mount in case it changed before the observer attached
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/**
 * Controlled CodeMirror 6 wrapper. We deliberately use CodeMirror (not Monaco)
 * for the node-config side panel — it's lightweight enough to live inline.
 *
 * The view is recreated only when `language`/`readOnly` change. External `value`
 * is synced via a transaction in a separate effect (only when it differs, to avoid
 * feedback loops). The editor theme follows the app light/dark theme live via a
 * Compartment: `oneDark` in dark mode, the default (light) highlight in light mode.
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
  const themeComp = useRef<Compartment | null>(null);
  if (!themeComp.current) themeComp.current = new Compartment();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isDark = useIsDarkTheme();
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          // basicSetup bundles lineNumbers/history/bracketMatching/closeBrackets/
          // indentOnInput/highlightActiveLine + default+history keymaps, plus the
          // default (light) syntax highlight that shows when oneDark is absent.
          basicSetup,
          langExt(language),
          themeComp.current!.of(isDarkRef.current ? oneDark : []),
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
    // Recreate only when language/readOnly change; value + theme are reconfigured below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  // Follow the app theme live without recreating the editor.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeComp.current!.reconfigure(isDark ? oneDark : []) });
  }, [isDark]);

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
