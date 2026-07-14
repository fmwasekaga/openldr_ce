/**
 * Live in-engine smoke for the QuickJS-WASM JS isolate (SEC-01).
 *
 * Drives the REAL workflow engine (`runWorkflow`) over minimal graphs — no mocks,
 * no stubs. It proves BOTH:
 *   (1) correctness — if / filter / switch conditions and a Code node produce the
 *       right results when evaluated through the isolate; and
 *   (2) the security boundary — a classic `Function`-constructor escape in a
 *       condition never reaches the host `process`, and a Code node sees
 *       `typeof process === 'undefined'` / `typeof require === 'undefined'`.
 *
 * Run: pnpm --filter @openldr/workflows exec tsx scripts/workflow-isolate-smoke.ts
 */
import { runWorkflow, type NodeRunResult } from '../src/engine/run-workflow';
import type { WorkflowNode } from '../src/engine/run-workflow';
import type { WorkflowEdge } from '../src/types';
import type { WorkflowItem } from '../src/engine/items';

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${label}`);
  }
}

const byId = (results: NodeRunResult[], id: string) => results.find((r) => r.nodeId === id);
const asItems = (out: unknown) => (out as WorkflowItem[] | undefined) ?? [];

/** Enabled Code-node limits (WORKFLOW_CODE_ENABLED=true equivalent). */
const CODE_LIMITS = { timeoutMs: 5000, memoryMb: 128, enabled: true };

async function main(): Promise<void> {
  // ------------------------------------------------------------------
  // 1. Condition correctness (if / filter / switch) through the isolate
  // ------------------------------------------------------------------
  console.log('Step 1: condition correctness (if / filter / switch)');

  // --- if: $json.n > 1 ---
  const ifNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    { id: 'c', type: 'condition', data: { templateId: 'if', condition: '$json.n > 1' } },
    { id: 'yes', type: 'action', data: { action: 'no-op' } },
    { id: 'no', type: 'action', data: { action: 'no-op' } },
  ];
  const ifEdges: WorkflowEdge[] = [
    { id: 'e1', source: 't', target: 'c' },
    { id: 'e2', source: 'c', target: 'yes', sourceHandle: 'true' },
    { id: 'e3', source: 'c', target: 'no', sourceHandle: 'false' },
  ];

  const ifTrue = await runWorkflow(ifNodes, ifEdges, { input: [{ json: { n: 2 } }] });
  check("if '$json.n > 1' over {n:2} -> branch 'true' (yes ran, no skipped)",
    ifTrue.status === 'completed'
    && byId(ifTrue.results, 'yes')?.status === 'success'
    && byId(ifTrue.results, 'no')?.status === 'skipped');

  const ifFalse = await runWorkflow(ifNodes, ifEdges, { input: [{ json: { n: 0 } }] });
  check("if '$json.n > 1' over {n:0} -> branch 'false' (no ran, yes skipped)",
    ifFalse.status === 'completed'
    && byId(ifFalse.results, 'no')?.status === 'success'
    && byId(ifFalse.results, 'yes')?.status === 'skipped');

  // --- filter: $json.keep === true ---
  const filterNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    { id: 'f', type: 'condition', data: { templateId: 'filter', condition: '$json.keep === true' } },
  ];
  const filterEdges: WorkflowEdge[] = [{ id: 'e1', source: 't', target: 'f' }];
  const filterRes = await runWorkflow(filterNodes, filterEdges, {
    input: [{ json: { keep: true } }, { json: { keep: false } }],
  });
  const kept = asItems(byId(filterRes.results, 'f')?.output);
  check("filter '$json.keep === true' keeps only the first item",
    filterRes.status === 'completed'
    && kept.length === 1
    && kept[0]?.json.keep === true);

  // --- switch: status 200 -> ok, >= 400 -> err ---
  const switchNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    {
      id: 's',
      type: 'condition',
      data: {
        templateId: 'switch',
        rules: [
          { name: 'ok', condition: '$json.status === 200' },
          { name: 'err', condition: '$json.status >= 400' },
        ],
        fallbackOutput: 'fallback',
      },
    },
    { id: 'okNode', type: 'action', data: { action: 'no-op' } },
    { id: 'errNode', type: 'action', data: { action: 'no-op' } },
  ];
  const switchEdges: WorkflowEdge[] = [
    { id: 'e1', source: 't', target: 's' },
    { id: 'e2', source: 's', target: 'okNode', sourceHandle: 'ok' },
    { id: 'e3', source: 's', target: 'errNode', sourceHandle: 'err' },
  ];
  const switchRes = await runWorkflow(switchNodes, switchEdges, { input: [{ json: { status: 500 } }] });
  check("switch over {status:500} -> branch 'err' (errNode ran, okNode skipped)",
    switchRes.status === 'completed'
    && byId(switchRes.results, 'errNode')?.status === 'success'
    && byId(switchRes.results, 'okNode')?.status === 'skipped');

  // ------------------------------------------------------------------
  // 2. Code node correctness (WORKFLOW_CODE_ENABLED=true)
  // ------------------------------------------------------------------
  console.log('Step 2: Code node correctness');
  const codeNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    { id: 'code', type: 'code', data: { code: 'return input.map(i => ({ json: { doubled: i.json.n * 2 } }))' } },
  ];
  const codeEdges: WorkflowEdge[] = [{ id: 'e1', source: 't', target: 'code' }];
  const codeRes = await runWorkflow(codeNodes, codeEdges, {
    input: [{ json: { n: 21 } }],
    codeLimits: CODE_LIMITS,
  });
  const doubled = asItems(byId(codeRes.results, 'code')?.output);
  check('Code node doubles n:21 -> doubled:42',
    codeRes.status === 'completed'
    && doubled.length === 1
    && doubled[0]?.json.doubled === 42);

  // ------------------------------------------------------------------
  // 3. Escape BLOCKED — the security proof
  // ------------------------------------------------------------------
  console.log('Step 3: escape blocked (security boundary)');

  // 3a. Condition Function-constructor escape must NOT reach host `process`.
  //     If the isolate leaked `process`, `.pid > 0` would be true -> branch 'true'
  //     -> `leak` node would run to success. It must NOT.
  const escNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    {
      id: 'c',
      type: 'condition',
      data: { templateId: 'if', condition: "this.constructor.constructor('return process')().pid > 0" },
    },
    { id: 'leak', type: 'action', data: { action: 'no-op' } },
  ];
  const escEdges: WorkflowEdge[] = [
    { id: 'e1', source: 't', target: 'c' },
    { id: 'e2', source: 'c', target: 'leak', sourceHandle: 'true' },
  ];
  const escRes = await runWorkflow(escNodes, escEdges, { input: [{ json: {} }] });
  const leak = byId(escRes.results, 'leak');
  // Host `process` unreachable => the escape either throws (run failed) or the
  // condition is falsy; in NEITHER case may the 'true'-branch `leak` node succeed.
  check("condition escape does NOT reach host process (leak node never succeeds)",
    leak?.status !== 'success');
  const condResult = byId(escRes.results, 'c');
  check("condition escape errors or resolves falsy (no host pid leaked)",
    escRes.status === 'failed' || condResult?.status === 'error' || leak?.status === 'skipped');

  // 3b. Code node sees no host globals.
  const probeNodes: WorkflowNode[] = [
    { id: 't', type: 'trigger', data: {} },
    { id: 'probe', type: 'code', data: { code: 'return [{ json: { p: typeof process, r: typeof require } }]' } },
  ];
  const probeEdges: WorkflowEdge[] = [{ id: 'e1', source: 't', target: 'probe' }];
  const probeRes = await runWorkflow(probeNodes, probeEdges, {
    input: [{ json: {} }],
    codeLimits: CODE_LIMITS,
  });
  const probe = asItems(byId(probeRes.results, 'probe')?.output)[0]?.json;
  check("Code node: typeof process === 'undefined'", probe?.p === 'undefined');
  check("Code node: typeof require === 'undefined'", probe?.r === 'undefined');

  console.log('');
  if (failures > 0) {
    console.error(`❌ workflow-isolate-smoke FAILED (${failures} assertion(s) failed)`);
    process.exit(1);
  }
  console.log('✅ workflow-isolate-smoke PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ workflow-isolate-smoke crashed:', err);
  process.exit(1);
});
