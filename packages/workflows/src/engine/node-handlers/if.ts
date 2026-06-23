import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/**
 * Evaluate a simple expression like `user.plan === 'premium'`. For safety we
 * run it inside a minimal vm context with just the upstream output exposed.
 * Returns `{ result: boolean, branch: 'true' | 'false' }`.
 *
 * Edge routing (picking the `true` vs `false` outgoing edge) is handled by
 * the runner, which reads `output.branch`.
 */
import vm from 'node:vm';

export const ifHandler: NodeHandler = async (node, ctx, upstream) => {
  const rawCondition = (node.data.condition as string | undefined) ?? '';
  const resolved = resolveTemplate(rawCondition, ctx, upstream);

  if (!resolved.trim()) {
    return { result: false, branch: 'false' as const };
  }

  try {
    const sandbox = {
      $input: upstream,
      input: upstream,
    };
    const result = vm.runInNewContext(resolved, sandbox, { timeout: 1000 });
    const bool = Boolean(result);
    return { result: bool, branch: (bool ? 'true' : 'false') as 'true' | 'false' };
  } catch (err) {
    throw new Error(
      `Condition failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
