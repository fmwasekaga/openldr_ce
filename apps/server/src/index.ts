import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext, createDbContext, seedDatabase, seedEssentials, drainCrashMarkersToAudit, guardAgainstCrashLoop } from '@openldr/bootstrap';
import { createLogger, makeCrashHandler } from '@openldr/core';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger({ level: cfg.LOG_LEVEL });

  // Studio shows a banner when the bypass is on, but a server-only/headless/CI run has no
  // UI to show it. Warn first thing so an unintended bypass is visible in the log too.
  if (cfg.AUTH_DEV_BYPASS) {
    logger.warn(
      'AUTH_DEV_BYPASS is ON — API requests are NOT authenticated. Local development only; never run a real deployment in this mode.',
    );
  }

  // Durable plugin-crash capture: a crashing Extism worker can take the whole process down
  // before the in-app audit DB write flushes. These handlers synchronously append a crash
  // marker (naming the in-flight plugin via the in-flight registry) to PLUGIN_CRASH_LOG_DIR,
  // then exit — replacing Node's default crash-and-die with capture-then-die. The next boot
  // drains the markers into the audit trail (see drainCrashMarkersToAudit below).
  process.on('uncaughtException', makeCrashHandler({
    dir: cfg.PLUGIN_CRASH_LOG_DIR, kind: 'uncaughtException',
    log: (m) => logger.fatal({ marker: m }, 'uncaughtException — wrote crash marker, exiting'),
  }));
  process.on('unhandledRejection', makeCrashHandler({
    dir: cfg.PLUGIN_CRASH_LOG_DIR, kind: 'unhandledRejection',
    log: (m) => logger.fatal({ marker: m }, 'unhandledRejection — wrote crash marker, exiting'),
  }));

  // Restart circuit-breaker: before doing any expensive startup, bail out with a backoff if we're
  // in a crash loop, so a repeatedly-crashing boot slows down instead of hot-spinning + flooding.
  const tripped = await guardAgainstCrashLoop({
    dir: cfg.PLUGIN_CRASH_LOG_DIR,
    threshold: cfg.CRASH_LOOP_THRESHOLD,
    windowSec: cfg.CRASH_LOOP_WINDOW_SEC,
    backoffMs: cfg.CRASH_LOOP_BACKOFF_MS,
    backoffCapMs: cfg.CRASH_LOOP_BACKOFF_CAP_MS,
    log: (v) => logger.fatal(v, 'restart loop detected — backing off before exit'),
  });
  if (tripped) return; // guard already called process.exit; return keeps types happy under test

  // Self-migrate on startup when enabled (single-port prod deployment). migrateToLatest is
  // idempotent, so a fresh DB gets its schema and an already-migrated one is a no-op. Runs
  // before any context that queries tables, so the app never serves 500s on an unmigrated DB.
  if (cfg.MIGRATE_ON_START) {
    const dbCtx = await createDbContext(cfg);
    try {
      const res = await dbCtx.migrateAll();
      if (res.internal.error || res.external.error) {
        throw (res.internal.error ?? res.external.error) as Error;
      }
      const internal = (res.internal.results ?? []).map((r) => r.migrationName);
      const external = (res.external.results ?? []).map((r) => r.migrationName);
      logger.info({ internal, external }, 'startup migration complete');
    } finally {
      await dbCtx.close();
    }
  }

  const ctx = await createAppContext(cfg);

  // Ingest any crash markers left by a previous process-FATAL plugin crash into the audit
  // trail (action plugin.crash / system.crash). Best-effort: a drain failure must not block
  // startup. Runs once the audit store is available.
  try {
    await drainCrashMarkersToAudit({ dir: cfg.PLUGIN_CRASH_LOG_DIR, audit: ctx.audit, logger: ctx.logger });
  } catch (err) {
    ctx.logger.warn({ err }, 'crash-marker audit drain failed at startup (continuing)');
  }

  // Seed idempotent sample data after migration. The FULL demo seed (org/location/patient
  // resources, all sample forms, default connector, dashboards, reports, terminology, feature
  // flags) is opt-in via SEED_ON_START. But a minimum set MUST exist on every install regardless
  // of that flag — the Users-page form, the Lab order form, and the inbound ingestion workflow
  // bound to it — so `seedEssentials` runs UNCONDITIONALLY (mirroring the boot-time
  // roles.seedSystemRoles() call in createAppContext, which is also deliberately not SEED_ON_START-
  // gated). Both paths are idempotent (forms deduped by name, workflows by id) and best-effort:
  // a seed failure must not block startup. The full seed already includes the essentials, so the
  // two are mutually exclusive here to avoid seeding them twice.
  if (cfg.SEED_ON_START) {
    const dbCtx = await createDbContext(cfg);
    try {
      const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(dbCtx, ctx);
      logger.info({ resources: resources.length, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology }, 'startup seed complete');
    } finally {
      await dbCtx.close();
    }
  } else {
    try {
      const { formsSeeded, workflowsSeeded } = await seedEssentials(ctx);
      logger.info({ formsSeeded, workflowsSeeded }, 'essential seed complete (SEED_ON_START off)');
    } catch (err) {
      logger.warn({ err }, 'essential seed failed (continuing)');
    }
  }

  const ingest = await createIngestContext(cfg);

  const app = await buildApp(ctx);

  await ctx.reportScheduler.registerRunner(ingest.eventing);
  // Arming existing schedules is best-effort: a pending migration or transient DB
  // hiccup must not block server startup (the runner re-arms on the next firing).
  try {
    await ctx.reportScheduler.reconcile(ingest.eventing);
  } catch (err) {
    ctx.logger.warn({ err }, 'report schedule reconcile failed at startup (continuing)');
  }

  // Plugin schedules (e.g. the DHIS2 webview plugin) fire headlessly through the host
  // runner. The legacy host DHIS2 scheduler has been removed (SP-A2 Task 14); plugin
  // schedules live in `plugin_data` (migration 036 copied the host rows over), so this
  // runner is now the sole driver of DHIS2 (and any other plugin) schedules.
  await ctx.pluginScheduleRunner.registerRunner(ingest.eventing);
  try {
    await ctx.pluginScheduleRunner.reconcile(ingest.eventing);
  } catch (err) {
    ctx.logger.warn({ err }, 'plugin schedule reconcile failed at startup (continuing)');
  }

  await ctx.workflows.runner.registerRunner(ingest.eventing);
  // Best-effort like the report scheduler: rebuild the ingest-id set + webhook registry
  // and arm saved schedules. A bad migration or DB hiccup must not block startup.
  try {
    ctx.workflows.runner.setIngestWorkflowIds(
      (await ctx.workflows.store.list())
        .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"ingest"'))
        .map((w) => w.id),
    );
    ctx.workflows.runner.setEventWorkflowIds(
      (await ctx.workflows.store.list())
        .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"event"'))
        .map((w) => w.id),
    );
    // Rebuild the webhook registry from saved workflows (async: resolves sealed webhook secrets — SEC-06).
    for (const w of await ctx.workflows.store.list()) await ctx.workflows.webhooks.sync(w.id, (w.definition as { nodes: unknown[] }).nodes ?? []);
    await ctx.workflows.runner.reconcile(ingest.eventing);
    await ctx.workflows.listeners.reconcile();
  } catch (err) {
    ctx.logger.warn({ err }, 'workflow trigger reconcile failed at startup (continuing)');
  }

  const worker = ingest.startWorker();

  const close = async () => {
    await worker.stop();
    await app.close();
    await ingest.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  // Bind to all interfaces; the reverse proxy owns the external port (P1-NFR-7).
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  process.stderr.write(`server failed to start: ${String(err)}\n`);
  process.exit(1);
});
