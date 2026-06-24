import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext, createDhis2Context, createDbContext, seedDatabase } from '@openldr/bootstrap';
import { createLogger } from '@openldr/core';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();

  // Self-migrate on startup when enabled (single-port prod deployment). migrateToLatest is
  // idempotent, so a fresh DB gets its schema and an already-migrated one is a no-op. Runs
  // before any context that queries tables, so the app never serves 500s on an unmigrated DB.
  if (cfg.MIGRATE_ON_START) {
    const logger = createLogger({ level: cfg.LOG_LEVEL });
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

  // Seed idempotent sample data after migration when enabled (prod demo). Needs the forms
  // store (AppContext) for sample forms and a DbContext for the FHIR resources. Idempotent:
  // dedups by name, so a populated DB is a no-op.
  if (cfg.SEED_ON_START) {
    const logger = createLogger({ level: cfg.LOG_LEVEL });
    const dbCtx = await createDbContext(cfg);
    try {
      const { resources, formsSeeded } = await seedDatabase(dbCtx, ctx);
      logger.info({ resources: resources.length, formsSeeded }, 'startup seed complete');
    } finally {
      await dbCtx.close();
    }
  }

  const ingest = await createIngestContext(cfg);

  // Build the DHIS2 context whenever DHIS2 is the reporting target so the admin
  // status + metadata routes work even with sync disabled. Sync wiring stays gated below.
  let dhis2: Awaited<ReturnType<typeof createDhis2Context>> | null = null;
  if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
    dhis2 = await createDhis2Context(cfg, { loadSink: (id, version) => ctx.plugins.loadSink(id, version) });
    // Expose DHIS2 push as a workflow sink. Gated on dhis2 truthiness (not SYNC_ENABLED)
    // so a workflow push works even with scheduled sync off. runMapping requires the
    // report/event-source callbacks, supplied from the reporting context.
    const dhis2Ctx = dhis2;
    ctx.workflows.services.dhis2Push = ({ mappingId, period, dryRun }) =>
      dhis2Ctx.runMapping({
        mappingId,
        period,
        dryRun: Boolean(dryRun),
        trigger: 'workflow',
        runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
        runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
      });
  }

  const app = buildApp(ctx, dhis2, ingest.eventing);

  if (dhis2 && cfg.DHIS2_SYNC_ENABLED) {
    await dhis2.registerSync(ingest.eventing, {
      runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
      runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
    });
    await dhis2.reconcileSchedules(ingest.eventing);
  }

  await ctx.reportScheduler.registerRunner(ingest.eventing);
  // Arming existing schedules is best-effort: a pending migration or transient DB
  // hiccup must not block server startup (the runner re-arms on the next firing).
  try {
    await ctx.reportScheduler.reconcile(ingest.eventing);
  } catch (err) {
    ctx.logger.warn({ err }, 'report schedule reconcile failed at startup (continuing)');
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
    // Rebuild the webhook registry from saved workflows.
    for (const w of await ctx.workflows.store.list()) ctx.workflows.webhooks.sync(w.id, (w.definition as { nodes: unknown[] }).nodes ?? []);
    await ctx.workflows.runner.reconcile(ingest.eventing);
  } catch (err) {
    ctx.logger.warn({ err }, 'workflow trigger reconcile failed at startup (continuing)');
  }

  const worker = ingest.startWorker();

  const close = async () => {
    await worker.stop();
    await app.close();
    await ingest.close();
    if (dhis2) await dhis2.close();
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
