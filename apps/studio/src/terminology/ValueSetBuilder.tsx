import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  saveValueSet,
  expandValueSet,
  listPublishers,
  type ValueSet,
  type ValueSetInput,
  type ValueSetComposeClause,
  type ExpandedCode,
  type CodingSystem,
  type Publisher,
} from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { TruncatedText } from '../components/ui/truncated-text';
import { ValueSetPicker } from './ValueSetPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

interface ValueSetBuilderProps {
  valueSet: ValueSet | null;
  systems: CodingSystem[];
  defaultPublisherId?: string;
  onSaved: (saved: ValueSet) => void;
  onCancel: () => void;
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}

const SENTINEL_NO_SYSTEM = '__none__';
type EditableClause = ValueSetComposeClause & { _key: string };

function randomKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function emptyClause(): EditableClause {
  return { _key: randomKey(), system: undefined, concept: [] };
}

function stripKey(inc: EditableClause): ValueSetComposeClause {
  const { _key: _key, ...rest } = inc;
  return rest;
}

export function ValueSetBuilder({
  valueSet,
  systems,
  defaultPublisherId,
  onSaved,
  onCancel,
  onExport,
  onDelete,
  onDuplicate,
}: ValueSetBuilderProps): JSX.Element {
  const readOnly = valueSet?.immutable ?? false;

  const [url, setUrl] = useState(valueSet?.url ?? '');
  const [title, setTitle] = useState(valueSet?.title ?? '');
  const [version, setVersion] = useState(valueSet?.version ?? '');
  const [status, setStatus] = useState<string>(valueSet?.status ?? 'draft');
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [publisherId, setPublisherId] = useState<string>(valueSet?.publisherId ?? defaultPublisherId ?? '');
  const [includes, setIncludes] = useState<EditableClause[]>(() =>
    valueSet?.compose.include?.length
      ? valueSet.compose.include.map((inc) => ({ ...inc, _key: randomKey() }))
      : [emptyClause()],
  );
  const [excludes, setExcludes] = useState<EditableClause[]>(
    (valueSet?.compose.exclude ?? []).map((c) => ({ _key: randomKey(), ...c })),
  );
  const [preview, setPreview] = useState<ExpandedCode[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(valueSet?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const composeInput = useMemo<ValueSetInput>(() => ({
    url: url.trim(),
    title: title.trim() || null,
    version: version.trim() || null,
    status,
    publisherId: publisherId || undefined,
    compose: {
      include: includes.map(stripKey),
      ...(excludes.length ? { exclude: excludes.map(stripKey) } : {}),
    },
  }), [url, title, version, status, publisherId, includes, excludes]);

  const refreshPreview = useCallback(async (id: string) => {
    setPreviewBusy(true);
    try {
      const exp = await expandValueSet(id, true);
      setPreview(exp?.codes ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }, []);

  useEffect(() => {
    void listPublishers().then(setPublishers);
  }, []);

  useEffect(() => {
    if (valueSet?.id) void refreshPreview(valueSet.id);
  }, [valueSet?.id, refreshPreview]);

  const handleSave = async (): Promise<void> => {
    if (!composeInput.url) {
      setError('A canonical URL is required.');
      return;
    }
    setError(null);
    try {
      const saved = await saveValueSet(composeInput);
      setSavedId(saved.id);
      onSaved(saved);
      await refreshPreview(saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const updateInclude = (i: number, patch: Partial<ValueSetComposeClause>): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, ...patch } : inc)));
  const removeInclude = (i: number): void => setIncludes((prev) => prev.filter((_, j) => j !== i));
  const addConcept = (i: number): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, concept: [...(inc.concept ?? []), { code: '', display: '' }] } : inc)));
  const updateConcept = (i: number, k: number, field: 'code' | 'display', value: string): void =>
    setIncludes((prev) => prev.map((inc, j) => {
      if (j !== i) return inc;
      const concept = [...(inc.concept ?? [])];
      concept[k] = { ...concept[k]!, [field]: value };
      return { ...inc, concept };
    }));
  const removeConcept = (i: number, k: number): void =>
    setIncludes((prev) => prev.map((inc, j) => (j === i ? { ...inc, concept: (inc.concept ?? []).filter((_, x) => x !== k) } : inc)));
  const importValueSetClause = (vsUrl: string): void => {
    if (includes.some((i) => i.valueSet?.includes(vsUrl))) return;
    setIncludes((prev) => [...prev, { _key: randomKey(), valueSet: [vsUrl] }]);
  };

  const updateExclude = (i: number, patch: Partial<ValueSetComposeClause>): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, ...patch } : exc)));
  const removeExclude = (i: number): void => setExcludes((prev) => prev.filter((_, j) => j !== i));
  const addExcludeConcept = (i: number): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, concept: [...(exc.concept ?? []), { code: '', display: '' }] } : exc)));
  const updateExcludeConcept = (i: number, k: number, field: 'code' | 'display', value: string): void =>
    setExcludes((prev) => prev.map((exc, j) => {
      if (j !== i) return exc;
      const concept = [...(exc.concept ?? [])];
      concept[k] = { ...concept[k]!, [field]: value };
      return { ...exc, concept };
    }));
  const removeExcludeConcept = (i: number, k: number): void =>
    setExcludes((prev) => prev.map((exc, j) => (j === i ? { ...exc, concept: (exc.concept ?? []).filter((_, x) => x !== k) } : exc)));

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="-mx-3 -mt-3 flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="min-w-0 text-sm font-medium text-foreground">
          <TruncatedText text={title.trim() || 'New value set'} className="min-w-0" />
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!readOnly && (
              <DropdownMenuItem onClick={() => void handleSave()} disabled={!composeInput.url}>Save</DropdownMenuItem>
            )}
            {readOnly && valueSet && onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(valueSet.id)}>Duplicate</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onCancel}>Cancel</DropdownMenuItem>
            {savedId && (
              <DropdownMenuItem disabled={previewBusy} onClick={() => void refreshPreview(savedId)}>Re-expand</DropdownMenuItem>
            )}
            {savedId && onExport && (
              <DropdownMenuItem onClick={() => onExport(savedId)}>Export</DropdownMenuItem>
            )}
            {savedId && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(savedId)}>Delete</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      {readOnly && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">This value set is immutable (standard catalog). Duplicate it to make changes.</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="valueset-url" className="text-xs">Canonical URL</Label>
          <Input id="valueset-url" className="h-8 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="urn:openldr:valueset:my-set" disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="valueset-title" className="text-xs">Title</Label>
          <Input id="valueset-title" className="h-8 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="valueset-version" className="text-xs">Version</Label>
          <Input id="valueset-version" className="h-8 text-sm" value={version} onChange={(e) => setVersion(e.target.value)} disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus} disabled={readOnly}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Publisher</Label>
          <Select value={publisherId} onValueChange={setPublisherId} disabled={readOnly}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select a publisher" /></SelectTrigger>
            <SelectContent>
              {publishers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Include</div>
        {includes.map((inc, i) => {
          if (inc.valueSet?.length) {
            return (
              <div key={inc._key} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                <span className="text-muted-foreground">Import</span>
                <span className="font-medium">Imports</span>
                <TruncatedText text={inc.valueSet.join(', ')} className="min-w-0 flex-1 font-mono text-primary" />
                <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeInclude(i)} aria-label="Delete" disabled={readOnly}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          }
          return (
            <div key={inc._key} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">System</Label>
                <Select value={inc.system ?? SENTINEL_NO_SYSTEM} onValueChange={(v) => updateInclude(i, { system: v === SENTINEL_NO_SYSTEM ? undefined : v })} disabled={readOnly}>
                  <SelectTrigger className="h-7 w-72 text-xs"><SelectValue placeholder="Pick a system" /></SelectTrigger>
                  <SelectContent>
                    {systems.map((s) => (
                      <SelectItem key={s.id} value={s.url ?? s.systemCode}>
                        <span className="font-mono text-xs">{s.systemCode}</span>
                        {s.url && <span className="ml-2 text-muted-foreground">{s.url}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeInclude(i)} aria-label="Delete" disabled={readOnly}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-1 pl-2">
                {(inc.concept ?? []).map((c, k) => (
                  <div key={k} className="flex items-center gap-1">
                    <Input className="h-7 w-28 text-xs" value={c.code} onChange={(e) => updateConcept(i, k, 'code', e.target.value)} placeholder="code" disabled={readOnly} />
                    <Input className="h-7 flex-1 text-xs" value={c.display ?? ''} onChange={(e) => updateConcept(i, k, 'display', e.target.value)} placeholder="display (optional)" disabled={readOnly} />
                    <button type="button" className="px-1 text-muted-foreground hover:text-destructive" onClick={() => removeConcept(i, k)} aria-label="Delete" disabled={readOnly}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {!readOnly && (
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => addConcept(i)}><Plus className="h-3 w-3" /> Add concept</button>
                )}
              </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="space-y-1">
            <Label className="text-xs">Import another value set</Label>
            <ValueSetPicker onPick={(vs) => importValueSetClause(vs.url)} placeholder="Search value sets to import..." />
          </div>
        )}
        {!readOnly && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => setIncludes((prev) => [...prev, emptyClause()])}><Plus className="h-3 w-3" /> Add include</button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exclude</div>
        {excludes.map((exc, i) => (
          <div key={exc._key} className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs">System</Label>
              <Select value={exc.system ?? SENTINEL_NO_SYSTEM} onValueChange={(v) => updateExclude(i, { system: v === SENTINEL_NO_SYSTEM ? undefined : v })} disabled={readOnly}>
                <SelectTrigger className="h-7 w-72 text-xs"><SelectValue placeholder="Pick a system" /></SelectTrigger>
                <SelectContent>
                  {systems.map((s) => (
                    <SelectItem key={s.id} value={s.url ?? s.systemCode}>
                      <span className="font-mono text-xs">{s.systemCode}</span>
                      {s.url && <span className="ml-2 text-muted-foreground">{s.url}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" className="ml-auto px-1 text-muted-foreground hover:text-destructive" onClick={() => removeExclude(i)} aria-label="Delete" disabled={readOnly}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-1 pl-2">
              {(exc.concept ?? []).map((c, k) => (
                <div key={k} className="flex items-center gap-1">
                  <Input className="h-7 w-28 text-xs" value={c.code} onChange={(e) => updateExcludeConcept(i, k, 'code', e.target.value)} placeholder="code" disabled={readOnly} />
                  <Input className="h-7 flex-1 text-xs" value={c.display ?? ''} onChange={(e) => updateExcludeConcept(i, k, 'display', e.target.value)} placeholder="display (optional)" disabled={readOnly} />
                  <button type="button" className="px-1 text-muted-foreground hover:text-destructive" onClick={() => removeExcludeConcept(i, k)} aria-label="Delete" disabled={readOnly}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {!readOnly && (
                <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => addExcludeConcept(i)}><Plus className="h-3 w-3" /> Add concept</button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80" onClick={() => setExcludes((prev) => [...prev, emptyClause()])}><Plus className="h-3 w-3" /> Add exclude</button>
        )}
      </div>

      <div className="flex-1 rounded-md border border-dashed border-border p-2">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Expansion ({preview.length})</div>
        {savedId == null ? (
          <p className="text-xs text-muted-foreground">Save to preview the expansion.</p>
        ) : preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">Expansion is empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {preview.map((c) => (
              <li key={`${c.system}|${c.code}`} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono text-primary">{c.code}</span>
                <span className="text-foreground">{c.display ?? '-'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
