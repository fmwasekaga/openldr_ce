/**
 * SECURITY WARNING (SEC-01) — Node's `vm` is NOT a security boundary.
 *
 * This module runs user-authored Code-node JavaScript via `vm.runInNewContext`
 * inside a worker_thread. That is NOT isolation: the constructor chain
 * (`this.constructor.constructor('return process')()`) reaches the worker's real
 * `process`, and worker_threads SHARE the host process's filesystem, network, and
 * environment. So Code-node authors effectively have HOST-LEVEL privileges
 * (read/write files, open sockets, read secrets/env). The sandbox.test.ts
 * "escape documentation" test asserts this on purpose.
 *
 * Because of this, Code-node execution is gated OFF by default behind
 * WORKFLOW_CODE_ENABLED (enforced in node-handlers/code.ts BEFORE this runs).
 * Only enable in trusted, single-tenant deployments.
 *
 * FOLLOW-UP (proper long-term fix): replace the `vm` boundary with a real
 * isolate — a separate unprivileged process (or container) with OS-level
 * filesystem/network restrictions, no inherited secrets, no network by default,
 * and hard CPU/memory/time limits — or a purpose-built isolate such as
 * `isolated-vm`. Tracked as a follow-up to this interim gating.
 */
import { Worker } from 'node:worker_threads';
import type { LogLevel } from '../types';

export interface SandboxLimits {
  timeoutMs: number;
  memoryMb: number;
}

export interface RunInSandboxOpts {
  input: unknown;
  nodeOutputs: Record<string, unknown>;
  limits: SandboxLimits;
  onLog: (level: LogLevel, message: string) => void;
}

/**
 * Bootstrap executed inside the worker (plain JS, eval mode → CommonJS, so
 * `require` is available here even though the package is ESM). It builds a vm
 * context exposing only $input/$node/console, runs the user code wrapped in an
 * async IIFE (so top-level await/return work), and posts results/logs back.
 */
export const BOOTSTRAP_JS = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { code, input, nodeOutputs } = workerData;
function stringify(args) {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
const mk = (level) => (...args) => parentPort.postMessage({ kind: 'log', level, message: stringify(args) });
const sandbox = {
  $input: input,
  input,
  $node: (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined,
  console: { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('log') },
};
const wrapped = '(async () => {\\n' + code + '\\n})()';
(async () => {
  try {
    const result = await vm.runInNewContext(wrapped, sandbox, { displayErrors: true });
    try {
      parentPort.postMessage({ kind: 'done', result });
    } catch (e) {
      parentPort.postMessage({ kind: 'error', message: 'Code node returned a non-serializable value' });
    }
  } catch (err) {
    parentPort.postMessage({ kind: 'error', message: (err && err.message) ? err.message : String(err) });
  }
})();
`;

export function runInSandbox(code: string, opts: RunInSandboxOpts): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(BOOTSTRAP_JS, {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: opts.limits.memoryMb },
        workerData: { code, input: opts.input, nodeOutputs: opts.nodeOutputs },
      });
    } catch (err) {
      reject(new Error(`Code node could not start: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Code node timed out after ${opts.limits.timeoutMs}ms`))),
      opts.limits.timeoutMs,
    );

    worker.on('message', (msg: { kind: string; level?: LogLevel; message?: unknown; result?: unknown }) => {
      if (msg.kind === 'log') opts.onLog((msg.level ?? 'log') as LogLevel, String(msg.message ?? ''));
      else if (msg.kind === 'done') finish(() => resolve(msg.result));
      else if (msg.kind === 'error') finish(() => reject(new Error(String(msg.message ?? 'Code node error'))));
    });
    worker.on('error', (err) => finish(() => reject(new Error(`Code node crashed: ${err.message}`))));
    worker.on('exit', (exitCode) => {
      if (!settled) {
        finish(() => reject(new Error(exitCode === 0 ? 'Code node exited without a result' : 'Code node exceeded its memory limit')));
      }
    });
  });
}
