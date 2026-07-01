import { CodeEditor } from '../node-forms/code-editor';

/** Read-only JSON viewer (renders via the CodeMirror editor). Shared by the live
 *  node config panel and the Run History per-node inspector. */
export function JsonView({ data, emptyLabel }: { data: unknown; emptyLabel: string }) {
  if (data === undefined || data === null) {
    return <p className="text-xs text-muted-foreground/70 italic">{emptyLabel}</p>;
  }

  let formatted: string;
  try {
    formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch {
    formatted = String(data);
  }

  return <CodeEditor language="json" value={formatted} onChange={() => {}} readOnly minHeight="8rem" />;
}
