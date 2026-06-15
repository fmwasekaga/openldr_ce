import { useEffect, useState } from 'react';
import type { CodingSystem, CodingSystemInput, Publisher } from '../api';
import { createCodingSystem, listPublishers, updateCodingSystem } from '../api';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  system: CodingSystem | null;
  /** Publisher to default to when creating (the rail's current selection). */
  defaultPublisherId?: string;
  onSaved: (s: CodingSystem) => void;
}

export function CodingSystemDialog({
  open,
  onOpenChange,
  system,
  defaultPublisherId,
  onSaved,
}: Props): JSX.Element {
  const editing = system !== null;

  const [systemCode, setSystemCode] = useState('');
  const [systemName, setSystemName] = useState('');
  const [url, setUrl] = useState('');
  const [systemVersion, setSystemVersion] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [publisherId, setPublisherId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch on open so a publisher created elsewhere in the session appears.
  useEffect(() => {
    if (open) void listPublishers().then(setPublishers);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSystemCode(system?.systemCode ?? '');
    setSystemName(system?.systemName ?? '');
    setUrl(system?.url ?? '');
    setSystemVersion(system?.systemVersion ?? '');
    setDescription(system?.description ?? '');
    setActive(system?.active ?? true);
    setPublisherId(system?.publisherId ?? defaultPublisherId ?? '');
    setError(null);
  }, [open, system, defaultPublisherId]);

  const canSave = systemCode.trim().length > 0 && systemName.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input: CodingSystemInput = {
        systemCode: systemCode.trim(),
        systemName: systemName.trim(),
        url: url.trim() || null,
        systemVersion: systemVersion.trim() || null,
        description: description.trim() || null,
        active,
        publisherId: publisherId || undefined,
      };
      const saved = editing
        ? await updateCodingSystem(system!.id, input)
        : await createCodingSystem(input);
      if (saved) onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>
            {editing ? 'Edit coding system' : 'New coding system'}
          </SheetTitle>
          <SheetDescription>
            Coding systems group terms by origin (LOINC, SNOMED, ICD, etc.) and appear in the terminology picker.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1">
            <Label htmlFor="systemCode" className="text-xs">System code</Label>
            <Input
              id="systemCode"
              value={systemCode}
              onChange={(e) => setSystemCode(e.target.value.toUpperCase())}
              placeholder="LOINC"
              className="h-9 text-sm font-mono"
              disabled={editing}
            />
            <p className="text-[11px] text-muted-foreground">
              Short uppercase identifier, e.g. LOINC, SNOMED-CT, ICD-10. Immutable once created.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="systemName" className="text-xs">System name</Label>
            <Input
              id="systemName"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              placeholder="Logical Observation Identifiers Names and Codes"
              className="h-9 text-sm"
            />
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div className="space-y-1">
              <Label htmlFor="systemUrl" className="text-xs">Canonical URL</Label>
              <Input
                id="systemUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://loinc.org"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Used in FHIR Coding.system. Leave blank for custom systems.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="systemVersion" className="text-xs">Version</Label>
              <Input
                id="systemVersion"
                value={systemVersion}
                onChange={(e) => setSystemVersion(e.target.value)}
                placeholder="2.76"
                className="h-9 text-sm font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="systemDescription" className="text-xs">Description</Label>
            <textarea
              id="systemDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="systemPublisher" className="text-xs">Publisher</Label>
            <Select value={publisherId} onValueChange={setPublisherId}>
              <SelectTrigger id="systemPublisher" className="h-9 text-sm">
                <SelectValue placeholder="Select a publisher" />
              </SelectTrigger>
              <SelectContent>
                {publishers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={active}
              onCheckedChange={(v) => setActive(v === true)}
            />
            <span>Active</span>
          </label>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border px-6 py-4 sm:justify-end">
          <Button disabled={saving || !canSave} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
