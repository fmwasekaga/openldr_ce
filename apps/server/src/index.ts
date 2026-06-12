import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext } from '@openldr/bootstrap';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const app = buildApp(ctx);

  const ingest = await createIngestContext(cfg);
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
