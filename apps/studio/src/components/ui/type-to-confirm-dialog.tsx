import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface TypeToConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  /** The exact phrase the operator must type to enable the confirm button. */
  confirmPhrase: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  /** Style the confirm button as destructive when the change is a risk-lowering one. */
  destructive?: boolean;
}

/**
 * GitHub-style type-to-confirm dialog: the operator must type the exact target
 * phrase before the confirm button enables. Used for changes that must not be
 * made casually (e.g. lowering validation strictness).
 */
export function TypeToConfirmDialog({
  open,
  title,
  body,
  confirmPhrase,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onOpenChange,
  destructive = false,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = React.useState('');

  // Reset the typed value whenever the dialog opens/closes so a stale value
  // from a previous confirmation doesn't leak into the next one.
  React.useEffect(() => {
    setTyped('');
  }, [open]);

  const matches = typed.trim() === confirmPhrase.trim() && confirmPhrase.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{body}</div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 pt-2">
          <label htmlFor="typeToConfirmInput" className="text-xs text-muted-foreground">
            Type <code className="font-mono font-semibold text-foreground">{confirmPhrase}</code> to confirm.
          </label>
          <Input
            id="typeToConfirmInput"
            aria-label="Confirm phrase"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            disabled={!matches}
            onClick={onConfirm}
            className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
