import { request, type FullConfig } from '@playwright/test';
import { BASE_URL } from './support/config';

const SEED_HELP = [
  '',
  'The stack appears unseeded or unreachable. Bring it up and seed it, then re-run:',
  '  docker compose up -d',
  '  pnpm e2e:seed',
].join('\n');

// Fail fast with actionable instructions if the live stack has no data, instead of
// letting individual specs fail with confusing UI errors.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const listRes = await ctx.get('/api/reports');
    if (!listRes.ok()) throw new Error(`GET /api/reports -> ${listRes.status()}${SEED_HELP}`);
    const reports = (await listRes.json()) as { id: string }[];
    if (!Array.isArray(reports) || reports.length === 0) {
      throw new Error(`GET /api/reports returned no reports.${SEED_HELP}`);
    }
    const amrRes = await ctx.get('/api/reports/amr-resistance');
    if (!amrRes.ok()) throw new Error(`GET /api/reports/amr-resistance -> ${amrRes.status()}${SEED_HELP}`);
    const amr = (await amrRes.json()) as { rows: unknown[] };
    if (!Array.isArray(amr.rows) || amr.rows.length === 0) {
      throw new Error(`amr-resistance has no rows (DB not seeded with WHONET data?).${SEED_HELP}`);
    }
  } finally {
    await ctx.dispose();
  }
}
