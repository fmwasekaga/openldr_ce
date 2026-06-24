import { z } from 'zod';

const indexEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['plugin', 'form-template', 'report-template', 'form', 'report', 'test-definition']),
  latestVersion: z.string().min(1),
  publisher: z.string().default(''),
  summary: z.string().default(''),
  readme: z.string().default(''),
  path: z.string().min(1),
  signatureFingerprint: z.string().optional(),
});

const indexSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().default('OpenLDR CE Marketplace'),
  updatedAt: z.string().default(''),
  packages: z.array(indexEntrySchema).default([]),
});

export type MarketplaceIndexEntry = z.infer<typeof indexEntrySchema>;
export type MarketplaceIndex = z.infer<typeof indexSchema>;

const EMPTY_INDEX: MarketplaceIndex = { schemaVersion: 1, name: 'OpenLDR CE Marketplace', updatedAt: '', packages: [] };

/** Parse an index.json. `null`/`undefined` (e.g. a 404 on first publish) yields an empty index. */
export function parseIndex(raw: unknown): MarketplaceIndex {
  if (raw === null || raw === undefined) return { ...EMPTY_INDEX };
  return indexSchema.parse(raw);
}

/** Update-or-append an entry by id and set updatedAt. Pure; caller supplies the timestamp. */
export function mergeIndexEntry(index: MarketplaceIndex, entry: MarketplaceIndexEntry, nowIso: string): MarketplaceIndex {
  const packages = index.packages.some((p) => p.id === entry.id)
    ? index.packages.map((p) => (p.id === entry.id ? entry : p))
    : [...index.packages, entry];
  return { ...index, updatedAt: nowIso, packages };
}
