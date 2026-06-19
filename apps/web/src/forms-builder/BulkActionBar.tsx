import { Button } from '@/components/ui/button';

export function BulkActionBar({ count, onDelete, onDuplicate, onClear }: { count: number; onDelete: () => void; onDuplicate: () => void; onClear: () => void }): JSX.Element | null {
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
      <span>{count} selected</span>
      <Button size="sm" variant="outline" onClick={onDuplicate}>Duplicate</Button>
      <Button size="sm" variant="outline" onClick={onDelete}>Delete</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}
