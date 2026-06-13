import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { createDbContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { exportCanonicalResources, exportFlatTables, type TableExport, type ExternalSchema } from '@openldr/db';
import { toCsv } from '@openldr/reporting';
import type { FhirResource } from '@openldr/fhir';

export interface ExportManifest {
  generatedAt: string;
  fhirResourceCount: number;
  tables: Record<string, number>;
  formats: string[];
}

export function toNdjson(resources: FhirResource[]): string {
  return resources.map((r) => JSON.stringify(r)).join('\n') + (resources.length ? '\n' : '');
}

export function toBundle(resources: FhirResource[]): { resourceType: 'Bundle'; type: 'collection'; entry: { resource: FhirResource }[] } {
  return { resourceType: 'Bundle', type: 'collection', entry: resources.map((r) => ({ resource: r })) };
}

export function buildManifest(resources: FhirResource[], tables: TableExport[], generatedAt: string): ExportManifest {
  const t: Record<string, number> = {};
  for (const x of tables) t[x.table] = x.rows.length;
  return { generatedAt, fhirResourceCount: resources.length, tables: t, formats: ['fhir.ndjson', 'fhir-bundle.json', 'csv'] };
}

export async function runExport(opts: { out: string; json: boolean }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    mkdirSync(opts.out, { recursive: true });
    const resources = await exportCanonicalResources(ctx.internalDb);
    writeFileSync(join(opts.out, 'fhir.ndjson'), toNdjson(resources));
    writeFileSync(join(opts.out, 'fhir-bundle.json'), JSON.stringify(toBundle(resources), null, 2) + '\n');

    const tables = await exportFlatTables(ctx.externalStore.db as unknown as Kysely<ExternalSchema>);
    for (const t of tables) {
      writeFileSync(join(opts.out, `${t.table}.csv`), toCsv(t.columns.map((k) => ({ key: k, label: k })), t.rows));
    }

    const manifest = buildManifest(resources, tables, new Date().toISOString());
    writeFileSync(join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    if (opts.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
    } else {
      process.stdout.write(`exported ${manifest.fhirResourceCount} FHIR resources + ${tables.length} flat tables to ${opts.out}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
