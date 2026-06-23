import type { NodeTypes } from '@xyflow/react';
import { TriggerNode } from './trigger-node';
import { ActionNode } from './action-node';
import { ConditionNode } from './condition-node';
import { LoopNode } from './loop-node';
import { WebhookNode } from './webhook-node';
import { CodeNode } from './code-node';

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  loop: LoopNode,
  webhook: WebhookNode,
  code: CodeNode,
};
