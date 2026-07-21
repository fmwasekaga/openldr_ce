import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderInput, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import {
  buildOntology,
  getOntologyDistribution,
  unlinkOntologyDistribution,
  type OntologyBuildProgress,
  type OntologyDistribution,
} from '../../api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

interface OntologyDistributionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codingSystemId: string;
  systemName: string;
  onChanged?: () => void;
}

type DistState = (OntologyDistribution & { stale: boolean }) | null;

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function progressLine(progress: OntologyBuildProgress): string {
  return `${progress.phase}: ${progress.processed}${progress.total != null ? `/${progress.total}` : ''}`;
}

export function OntologyDistributionDialog({
  open,
  onOpenChange,
  codingSystemId,
  systemName,
  onChanged,
}: OntologyDistributionDialogProps): JSX.Element {
  const [dist, setDist] = useState<DistState>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [progress, setProgress] = useState<OntologyBuildProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const reload = useCallback(async () => {
    if (!codingSystemId) return;
    setLoading(true);
    try {
      const next = await getOntologyDistribution(codingSystemId);
      setDist(next);
      setSourcePath((prev) => prev || next?.sourcePath || '');
    } finally {
      setLoading(false);
    }
  }, [codingSystemId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProgress(null);
    setSourcePath('');
    void reload();
  }, [open, reload]);

  const runBuild = useCallback(
    async (kind: 'build' | 'rebuild') => {
      const trimmedPath = sourcePath.trim();
      if (kind === 'build' && !trimmedPath) return;
      setBusy(true);
      setError(null);
      setProgress(null);
      try {
        const { promise } =
          kind === 'rebuild'
            ? buildOntology(codingSystemId, { rebuild: true }, setProgress)
            : buildOntology(codingSystemId, { path: trimmedPath }, setProgress);
        await promise;
        onChanged?.();
        await reload();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [codingSystemId, onChanged, reload, sourcePath],
  );

  const handleUnlink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkOntologyDistribution(codingSystemId);
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [codingSystemId, onChanged, onOpenChange]);

  const status = dist?.indexStatus ?? 'none';
  const canRebuild = dist && (status === 'ready' || status === 'stale' || status === 'error' || dist.stale);
  const canBuild = sourcePath.trim().length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[560px] p-0">
          <div className="flex flex-col gap-1 border-b border-border px-6 py-0">
            <DialogTitle>Ontology distribution for {systemName}</DialogTitle>
            {(status === 'none' || dist === null) && (
              <DialogDescription>No ontology distribution is linked for this coding system.</DialogDescription>
            )}
            {status !== 'none' && dist !== null && (
              <DialogDescription className="sr-only">Manage the linked ontology distribution.</DialogDescription>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
            <div className="flex flex-col gap-4 px-6 py-5">
              {dist?.stale && status !== 'error' && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>This ontology index may be stale. Rebuild it before relying on browse results.</span>
                </div>
              )}
              {status === 'error' && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{dist?.indexError ?? 'The ontology build failed.'}</span>
                </div>
              )}

              {status === 'ready' && dist && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {dist.ontologyType}
                    </Badge>
                  </dd>
                  <dt className="text-muted-foreground">Nodes</dt>
                  <dd className="font-mono text-foreground">{dist.nodeCount ?? '-'}</dd>
                  <dt className="text-muted-foreground">Edges</dt>
                  <dd className="font-mono text-foreground">{dist.edgeCount ?? '-'}</dd>
                  <dt className="text-muted-foreground">Built at</dt>
                  <dd className="text-foreground">{formatDate(dist.builtAt)}</dd>
                  <dt className="text-muted-foreground">Source path</dt>
                  <dd className="break-all font-mono text-foreground">{dist.sourcePath}</dd>
                </dl>
              )}

              <div className="space-y-2">
                <Label htmlFor="ontologySourcePath" className="text-xs">
                  Server path
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="ontologySourcePath"
                    aria-label="Server path"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="D:\\terminology\\loinc"
                    className="h-8 text-xs font-mono"
                    disabled={busy}
                  />
                  <Button
                    size="sm"
                    className="h-8 gap-2 text-xs"
                    disabled={busy || !canBuild}
                    onClick={() => void runBuild('build')}
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    Build
                  </Button>
                </div>
              </div>

              {busy && progress && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="font-mono">{progressLine(progress)}</span>
                </div>
              )}
              {busy && !progress && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Building ontology index...</span>
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-3">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <div className="flex justify-end gap-2">
                {canRebuild && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 text-xs"
                    disabled={busy}
                    onClick={() => void runBuild('rebuild')}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rebuild
                  </Button>
                )}
                {dist && status !== 'none' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 text-xs text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setConfirmUnlink(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Unlink
                  </Button>
                )}
              </div>
            </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title="Unlink ontology distribution"
        description={`Unlink the ontology distribution for ${systemName}? The source files are not deleted.`}
        confirmLabel="Unlink"
        destructive
        onConfirm={() => {
          setConfirmUnlink(false);
          void handleUnlink();
        }}
      />
    </>
  );
}
