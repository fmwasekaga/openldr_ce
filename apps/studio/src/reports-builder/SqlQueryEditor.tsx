import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WidgetQuery } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;
type Values = NonNullable<SqlQuery['values']>;

const VAR = /\{\{(\w+)\}\}/g;
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

function detectVars(sql: string): string[] {
  const m = sql.match(VAR);
  return m ? [...new Set(m.map((x) => x.slice(2, -2)))] : [];
}
function boundParamId(v: unknown): string {
  return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : '';
}

export function SqlQueryEditor({ open, sql, values, parameters, sqlEnabled, onClose, onSave }: {
  open: boolean;
  sql: string;
  values: Values;
  parameters: ReportParam[];
  sqlEnabled: boolean;
  onClose: () => void;
  onSave: (q: SqlQuery) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [sqlText, setSqlText] = useState(sql);
  const [vals, setVals] = useState<Values>(values);
  const readOnly = !sqlEnabled;

  const view = useRef<EditorView>();
  const sqlRef = useRef(sqlText);
  sqlRef.current = sqlText;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // CodeMirror mount via callback ref (Radix portal attaches the node after the parent effect).
  const onEditorMount = useCallback((node: HTMLDivElement | null) => {
    if (node && !view.current) {
      try {
        view.current = new EditorView({
          parent: node,
          doc: sqlRef.current,
          extensions: [
            basicSetup,
            sqlLang(),
            oneDark,
            EditorState.readOnly.of(readOnlyRef.current),
            EditorView.editable.of(!readOnlyRef.current),
            EditorView.updateListener.of((u) => { if (u.docChanged) setSqlText(u.state.doc.toString()); }),
            EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto' } }),
          ],
        });
      } catch {
        /* jsdom lacks layout APIs CodeMirror needs; the sr-only textarea covers tests */
      }
    } else if (!node && view.current) {
      view.current.destroy();
      view.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) { setSqlText(sql); setVals(values); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const vars = detectVars(sqlText);
  const bind = (v: string, paramId: string) => setVals((prev) => {
    const next = { ...prev };
    if (paramId) next[v] = `{{param.${paramId}}}`;
    else delete next[v];
    return next;
  });
  const save = () => {
    // Only keep values for vars still present in the SQL.
    const kept: Values = {};
    for (const v of vars) if (vals[v] != null) kept[v] = vals[v];
    onSave({ mode: 'sql', sql: sqlText, values: kept });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] w-[80vw] max-w-3xl flex-col gap-0 p-0">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base font-semibold">{t('reportBuilder.sql.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('reportBuilder.sql.description')}</DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div ref={onEditorMount} className="h-full" />
            <textarea aria-label="SQL" className="sr-only" readOnly={readOnly} value={sqlText} onChange={(e) => setSqlText(e.target.value)} />
          </div>
          {vars.length > 0 && (
            <div className="max-h-40 overflow-y-auto border-t border-border p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportBuilder.sql.bindVariables')}</div>
              <div className="flex flex-col gap-1">
                {vars.map((v) => (
                  <div key={v} className="flex items-center gap-2 text-xs">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{`{{${v}}}`}</code>
                    <select
                      aria-label={`bind-${v}`}
                      className="h-7 flex-1 rounded border border-border bg-background text-xs"
                      value={boundParamId(vals[v])}
                      onChange={(e) => bind(v, e.target.value)}
                    >
                      <option value="">{t('reportBuilder.filters.unbound')}</option>
                      {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={save}>{t('common.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
