import { request, type FullConfig } from '@playwright/test';
import { BASE_URL } from './support/config';
import { ensureDocsFixtures } from './capture-docs/fixtures';

const SEED_HELP = [
  '',
  'The stack appears unseeded or unreachable. Bring it up and seed it, then re-run:',
  '  docker compose up -d',
  '  pnpm e2e:seed',
].join('\n');
const DOCS_SEED_HELP = [
  '',
  'The docs capture stack appears unseeded or unreachable. Bring it up and seed it, then re-run:',
  '  docker compose up -d',
  '  pnpm docs:seed',
].join('\n');

// Fail fast with actionable instructions if the live stack has no data, instead of
// letting individual specs fail with confusing UI errors.
async function validateReports(ctx: Awaited<ReturnType<typeof request.newContext>>, help: string) {
  const listRes = await ctx.get('/api/reports');
  if (!listRes.ok()) throw new Error(`GET /api/reports -> ${listRes.status()}${help}`);
  const reports = (await listRes.json()) as { id: string }[];
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error(`GET /api/reports returned no reports.${help}`);
  }
  // r-amr-resistance is data-driven (seedDataDrivenReports) and requires a from/to window.
  const amrRes = await ctx.get('/api/reports/r-amr-resistance?from=2000-01-01&to=2100-01-01');
  if (!amrRes.ok()) throw new Error(`GET /api/reports/r-amr-resistance -> ${amrRes.status()}${help}`);
  const amr = (await amrRes.json()) as { rows: unknown[] };
  if (!Array.isArray(amr.rows) || amr.rows.length === 0) {
    throw new Error(`amr-resistance has no rows (DB not seeded with WHONET data?).${help}`);
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const isDocsCapture = config.projects.some((project) => project.name === 'docs-capture');
    if (!isDocsCapture) {
      await validateReports(ctx, SEED_HELP);
      return;
    }
    await validateReports(ctx, DOCS_SEED_HELP);
    const pluginsRes = await ctx.get('/api/connectors/sink-plugins');
    if (!pluginsRes.ok()) throw new Error(`GET /api/connectors/sink-plugins -> ${pluginsRes.status()}${DOCS_SEED_HELP}`);
    const plugins = (await pluginsRes.json()) as Array<{ id: string }>;
    if (!plugins.some((plugin) => plugin.id === 'test-sink')) {
      throw new Error(`test-sink is not installed.${DOCS_SEED_HELP}`);
    }
    await ensureDocsFixtures(ctx);
  } finally {
    await ctx.dispose();
  }
}
