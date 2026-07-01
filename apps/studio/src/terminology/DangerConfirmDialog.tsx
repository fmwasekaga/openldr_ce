import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The exact text the user must type to enable the destructive action. */
  confirmName: string;
  /** Label for the destructive action button (e.g. "Delete"). */
  confirmLabel: string;
  /** Blast-radius summary (counts, warnings) rendered above the input. */
  summary: ReactNode;
  onConfirm: () => void;
}

/**
 * GitHub-style destructive confirmation: shows what will be permanently
 * affected and requires the user to type the exact name before the action
 * button enables.
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  confirmName,
  confirmLabel,
  summary,
  onConfirm,
}: Props): JSX.Element {
  const [typed, setTyped] = useState('');

  // Reset input whenever the dialog opens.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches =
    typed.trim() === confirmName.trim() && confirmName.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {summary}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3 pt-2">
          <Label htmlFor="dangerConfirmInput" className="text-xs">
            Type <code className="font-mono font-semibold">{confirmName}</code>{' '}
            to confirm.
          </Label>
          <Input
            id="dangerConfirmInput"
            aria-label="Confirm name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-9 text-sm"
            autoComplete="off"
            autoFocus
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
