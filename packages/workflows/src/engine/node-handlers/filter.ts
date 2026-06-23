import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/**
 * Filter node — evaluates a condition expression. If truthy, passes upstream
 * data through (branch: 'true'). If falsy, signals the runner to prune
 * downstream edges (branch: 'false'). Unlike the If node, Filter has only
 * one output handle ('true'), so a 'false' branch means nothing continues.
 */
export const filterHandler: NodeHandler = async (node, ctx, upstream) => {
  const rawCondition = (node.data.condition as string | undefined) ?? '';
  const resolved = resolveTemplate(rawCondition, ctx, upstream);

  if (!resolved.trim()) {
    return { passed: false, branch: 'false' as const };
  }

  try {
    const sandbox = { $input: upstream, input: upstream };
    const result = vm.runInNewContext(resolved, sandbox, { timeout: 1000 });
    const passed = Boolean(result);
    return {
      passed,
      branch: (passed ? 'true' : 'false') as 'true' | 'false',
      data: passed ? upstream : undefined,
    };
  } catch (err) {
    throw new Error(
      `Filter condition failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
