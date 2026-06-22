import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext, createDhis2Context } from '@openldr/bootstrap';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const ingest = await createIngestContext(cfg);

  // Build the DHIS2 context whenever DHIS2 is the reporting target so the admin
  // status + metadata routes work even with sync disabled. Sync wiring stays gated below.
  let dhis2: Awaited<ReturnType<typeof createDhis2Context>> | null = null;
  if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
    dhis2 = await createDhis2Context(cfg);
  }

  const app = buildApp(ctx, dhis2, ingest.eventing);

  if (dhis2 && cfg.DHIS2_SYNC_ENABLED) {
    await dhis2.registerSync(ingest.eventing, {
      runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
      runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
    });
    await dhis2.reconcileSchedules(ingest.eventing);
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
