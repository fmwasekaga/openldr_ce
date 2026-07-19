// Sync Slice 1 (Task 1): SyncRuntime owns the sync worker lifecycle and is re-runnable — calling
// reconcile() again tears down whatever workers are live and rebuilds from a freshly-read config.
// This is what lets the Settings toggle take effect immediately: instead of the worker set being
// fixed at boot, bootstrap can call reconcile() whenever the config changes and the runtime figures
// out what to start/stop. Worker construction is injected (buildPush/buildPull) so this file has no
// DB dependency and is unit-testable with fakes.

import type { Logger } from '@openldr/core';
import type { SyncConfig } from '@openldr/sync';
import type { SyncMode } from './sync-handle';

/** A started worker the runtime can stop/trigger/inspect (DrainWorker-shaped). */
export interface RuntimeWorker { start(): void; stop(): void; trigger(): void; isRunning(): boolean; }

export interface BuiltPush { worker: RuntimeWorker; listenClient?: { end(): Promise<unknown> }; }
// retryQuarantine is derived in the PULL block (createRetryQuarantine), so it rides with the pull result.
export interface BuiltPull { worker: RuntimeWorker; retryQuarantine?: (t: string, id: string) => Promise<{ ok: boolean; error?: string }>; }

export interface SyncRuntimeDeps {
  logger: Logger;
  /** Re-read the current sync config (null = disabled/misconfigured). Called on every reconcile. */
  readConfig: () => Promise<SyncConfig | null>;
  /** Build the push worker for this config (mode already known to include push); the runtime calls start(). */
  buildPush: (cfg: SyncConfig) => Promise<BuiltPush>;
  /** Build the pull worker for this config (mode already known to include pull); the runtime calls start(). */
  buildPull: (cfg: SyncConfig) => Promise<BuiltPull>;
}

// Which directions run for a given mode. Push runs for 'push' + 'bidirectional'; pull runs for
// 'pull' + 'bidirectional'. doReconcile's worker gates below use these. This is the CANONICAL copy —
// it lives here (not index.ts) because index.ts imports this module, so keeping the logic here avoids
// a circular import. sync-mode-gating.test.ts imports these directly to pin the wiring.
export const shouldStartPush = (mode: SyncMode): boolean => mode !== 'pull';
export const shouldStartPull = (mode: SyncMode): boolean => mode !== 'push';

export interface SyncRuntime {
  reconcile(): Promise<void>;
  stop(): Promise<void>;
  isEnabled(): boolean;
  mode(): SyncMode;
  centralUrl(): string;
  siteId(): string;
  pushWorker(): RuntimeWorker | undefined;
  pullWorker(): RuntimeWorker | undefined;
  retryQuarantine(): ((t: string, id: string) => Promise<{ ok: boolean; error?: string }>) | undefined;
}

export function createSyncRuntime(deps: SyncRuntimeDeps): SyncRuntime {
  let push: BuiltPush | undefined;
  let pull: BuiltPull | undefined;
  let enabled = false;
  let mode: SyncMode = 'bidirectional';
  let centralUrl = '';
  let siteId = '';
  let chain: Promise<void> = Promise.resolve();

  const teardown = async (): Promise<void> => {
    push?.worker.stop();
    pull?.worker.stop();
    if (push?.listenClient) await push.listenClient.end().catch((err) => deps.logger.warn({ err }, 'sync: listen client end failed'));
    push = undefined;
    pull = undefined;
  };

  const doReconcile = async (): Promise<void> => {
    await teardown();
    const cfg = await deps.readConfig();
    if (!cfg) { enabled = false; mode = 'bidirectional'; centralUrl = ''; siteId = ''; deps.logger.info('sync disabled (not configured)'); return; }
    try {
      if (shouldStartPush(cfg.mode)) { push = await deps.buildPush(cfg); push.worker.start(); }
      if (shouldStartPull(cfg.mode)) { pull = await deps.buildPull(cfg); pull.worker.start(); }
    } catch (err) {
      // Partial build failure: never leave state claiming workers that aren't running.
      await teardown();
      enabled = false;
      throw err;
    }
    mode = cfg.mode; centralUrl = cfg.centralUrl; siteId = cfg.siteId; enabled = true;
    deps.logger.info(
      { mode: cfg.mode, intervalMinutes: cfg.intervalMinutes, centralUrl: cfg.centralUrl, siteId: cfg.siteId },
      'sync workers reconciled',
    );
  };

  return {
    reconcile(): Promise<void> {
      chain = chain.then(doReconcile, doReconcile);
      return chain;
    },
    async stop(): Promise<void> { chain = chain.then(teardown, teardown); return chain; },
    isEnabled: () => enabled,
    mode: () => mode,
    centralUrl: () => centralUrl,
    siteId: () => siteId,
    pushWorker: () => push?.worker,
    pullWorker: () => pull?.worker,
    retryQuarantine: () => pull?.retryQuarantine,
  };
}
