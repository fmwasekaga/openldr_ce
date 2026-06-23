import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AppShell } from '@/shell/AppShell';
import { Canvas } from './components/canvas';
import { Sidebar } from './components/sidebar';
import { NodeConfigPanel } from './components/panels/node-config-panel';
import { Toolbar } from './components/panels/toolbar';
import { ExecutionPanel } from './components/panels/execution-panel';
import { RunHistoryDrawer } from './components/panels/run-history-drawer';
import { useWorkflowStore } from './hooks/use-workflow-store';
import { useWorkflowApi } from './hooks/use-workflow-api';

export function Workflows() {
  const configNodeId = useWorkflowStore((s) => s.configNodeId);
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const { save, execute, fireTrigger, saving, executing, lastExecution } = useWorkflowApi();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <AppShell title="Workflows" fullBleed>
      <ReactFlowProvider>
        <div className="flex h-full flex-col">
          <Toolbar
            onSave={save}
            onRun={execute}
            onHistory={() => setHistoryOpen(true)}
            saving={saving}
            executing={executing}
          />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col">
              <div className="flex-1">
                <Canvas onFireTrigger={fireTrigger} />
              </div>
              <ExecutionPanel executing={executing} lastExecution={lastExecution} />
            </div>
            {configNodeId && <NodeConfigPanel />}
          </div>
        </div>
        {workflowId && (
          <RunHistoryDrawer
            open={historyOpen}
            workflowId={workflowId}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </ReactFlowProvider>
    </AppShell>
  );
}
