import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchWorkflows, createWorkflow, deleteWorkflow, type Workflow } from '@/api';

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function WorkflowList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Workflow[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchWorkflows()); }
    catch (e) { toast.error(`Failed to load workflows: ${e instanceof Error ? e.message : String(e)}`); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onDuplicate = useCallback(async (w: Workflow) => {
    try {
      await createWorkflow({
        id: newWorkflowId(), name: `${w.name} (copy)`, description: w.description,
        definition: w.definition, enabled: w.enabled, createdBy: null,
      });
      toast.success(`Duplicated ${w.name}`);
      await load();
    } catch (e) { toast.error(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [load]);

  const onDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const w = pendingDelete; setPendingDelete(null);
    try { await deleteWorkflow(w.id); await load(); }
    catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [pendingDelete, load]);

  return (
    <AppShell title="Workflows" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="workflow-list">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Workflows</h1>
          <Button data-testid="workflow-new" onClick={() => navigate('/workflows/new')}>New workflow</Button>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No workflows yet. Create one to get started.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => (
                <TableRow key={w.id} data-testid={`workflow-row-${w.id}`}>
                  <TableCell>
                    <button
                      className="font-medium text-primary hover:underline"
                      data-testid={`open-${w.id}`}
                      onClick={() => navigate(`/workflows/${w.id}`)}
                    >
                      {w.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={w.enabled ? 'default' : 'outline'}>
                      {w.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {w.updatedAt ? new Date(w.updatedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`open-btn-${w.id}`}
                        onClick={() => navigate(`/workflows/${w.id}`)}
                      >
                        Open
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`duplicate-${w.id}`}
                        onClick={() => void onDuplicate(w)}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`delete-${w.id}`}
                        onClick={() => setPendingDelete(w)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        description="This permanently deletes the workflow design."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { void onDelete(); }}
      />
    </AppShell>
  );
}
