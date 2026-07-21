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
import { Spinner } from '../components/ui/spinner';

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
  /** May be async — the dialog shows a busy state and stays open until it settles. */
  onConfirm: () => void | Promise<void>;
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
  const [busy, setBusy] = useState(false);

  // Reset input + busy whenever the dialog opens.
  useEffect(() => {
    if (open) { setTyped(''); setBusy(false); }
  }, [open]);

  const matches =
    typed.trim() === confirmName.trim() && confirmName.trim().length > 0;

  return (
    // While the destructive action is running, block dismissal (backdrop/Esc) so it can't be
    // interrupted; the parent closes the dialog by flipping `open` once onConfirm settles.
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
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
            disabled={busy}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || busy}
            // preventDefault so the dialog does not auto-close on click; we keep it open (with a
            // busy spinner) until the async onConfirm settles, then the parent flips `open`.
            onClick={(e) => {
              e.preventDefault();
              setBusy(true);
              void Promise.resolve(onConfirm()).finally(() => setBusy(false));
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Spinner className="mr-2 text-destructive-foreground" />}
            {busy ? `${confirmLabel}…` : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
