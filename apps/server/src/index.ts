import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext, createDbContext, seedDatabase, drainCrashMarkersToAudit } from '@openldr/bootstrap';
import { createLogger, makeCrashHandler } from '@openldr/core';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger({ level: cfg.LOG_LEVEL });

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

  // Seed idempotent sample data after migration when enabled (prod demo). Needs the forms
  // store (AppContext) for sample forms and a DbContext for the FHIR resources. Idempotent:
  // dedups by name, so a populated DB is a no-op.
  if (cfg.SEED_ON_START) {
    const dbCtx = await createDbContext(cfg);
    try {
      const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, terminology } = await seedDatabase(dbCtx, ctx);
      logger.info({ resources: resources.length, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, terminology }, 'startup seed complete');
    } finally {
      await dbCtx.close();
    }
  }

  const ingest = await createIngestContext(cfg);

  const app = buildApp(ctx);

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
    // Rebuild the webhook registry from saved workflows.
    for (const w of await ctx.workflows.store.list()) ctx.workflows.webhooks.sync(w.id, (w.definition as { nodes: unknown[] }).nodes ?? []);
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
