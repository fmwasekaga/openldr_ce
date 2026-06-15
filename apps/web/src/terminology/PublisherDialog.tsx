import { useEffect, useState } from 'react';
import type { Publisher, PublisherInput } from '../api';
import { createPublisher, updatePublisher } from '../api';
import { Button } from '../components/ui/button';
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
  publisher: Publisher | null;
  onSaved: (publisher: Publisher) => void;
}

export function PublisherDialog({ open, onOpenChange, publisher, onSaved }: Props): JSX.Element {
  const editing = publisher !== null;

  const [name, setName] = useState('');
  // PublisherInput only accepts 'local' | 'external'. Seeded publishers may
  // carry other roles (e.g. 'standard') but the Select is disabled for them,
  // so we default to 'local' to keep the controlled Select valid.
  const [role, setRole] = useState<'local' | 'external'>('local');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seeded = publisher?.seeded ?? false;

  useEffect(() => {
    if (!open) return;
    setName(publisher?.name ?? '');
    setRole(publisher?.role === 'external' ? 'external' : 'local');
    setIcon(publisher?.icon ?? '');
    setError(null);
  }, [open, publisher]);

  const canSave = name.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input: PublisherInput = {
        name: name.trim(),
        role,
        icon: icon.trim() || null,
      };
      const saved = editing
        ? await updatePublisher(publisher!.id, input)
        : await createPublisher(input);
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>
            {editing ? 'Edit publisher' : 'New publisher'}
          </SheetTitle>
          <SheetDescription>
            Publishers group code systems and value sets by their source.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1">
            <Label htmlFor="publisherName" className="text-xs">Name</Label>
            <Input
              id="publisherName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your Lab"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="publisherRole" className="text-xs">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as 'local' | 'external')}
              disabled={seeded}
            >
              <SelectTrigger id="publisherRole" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="external">External</SelectItem>
              </SelectContent>
            </Select>
            {seeded && (
              <p className="text-[11px] text-muted-foreground">
                Built-in publishers have a fixed role.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="publisherIcon" className="text-xs">Icon</Label>
            <Input
              id="publisherIcon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Optional short glyph or emoji shown in the rail.
            </p>
          </div>

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
