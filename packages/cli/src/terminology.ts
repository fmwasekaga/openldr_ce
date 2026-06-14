import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createTerminologyContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';

function out(json: boolean, obj: unknown, human: string): void {
  process.stdout.write((json ? JSON.stringify(obj, null, 2) : human) + '\n');
}

export async function runTerminologyImport(kind: string, path: string, opts: { acceptLicense?: boolean; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    if (kind === 'loinc') { const r = await ctx.loaders.loinc(path, !!opts.acceptLicense); out(opts.json, r, `loaded ${r.conceptsLoaded} LOINC concepts`); }
    else if (kind === 'amr') { const r = await ctx.loaders.amr(path); out(opts.json, r, r.map((x) => `${x.system}: ${x.conceptsLoaded}`).join('\n')); }
    else if (kind === 'resource') { const r = await ctx.loaders.resource(JSON.parse(readFileSync(path, 'utf8'))); out(opts.json, r, `imported ${r.resourceUrl} (${r.conceptsLoaded} concepts)`); }
    else { process.stderr.write(`unknown import kind '${kind}' (loinc|amr|resource)\n`); return 1; }
    return 0;
  } catch (err) { process.stderr.write(`terminology import failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyLookup(system: string, code: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.lookup(system, code); out(opts.json, r, r.found ? `${code}: ${r.display}` : `${code} not found`); return r.found ? 0 : 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyValidate(opts: { system?: string; code: string; valueset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const r = opts.valueset ? await ctx.ops.validateCode({ valueSetUrl: opts.valueset, code: opts.code }) : await ctx.ops.validateCode({ system: opts.system!, code: opts.code });
    out(opts.json, r, `${r.result}: ${r.message}`); return r.result ? 0 : 1;
  } finally { await ctx.close(); }
}

export async function runTerminologyExpand(url: string, opts: { count?: string; offset?: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const vs = await ctx.ops.expand(url, { count: opts.count ? Number(opts.count) : undefined, offset: opts.offset ? Number(opts.offset) : undefined });
    out(opts.json, vs, `${vs.expansion?.total ?? 0} total; ${(vs.expansion?.contains ?? []).map((c) => c.code).join(', ')}`); return 0;
  } catch (err) { process.stderr.write(`expand failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyTranslate(url: string, opts: { system: string; code: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.translate({ mapUrl: url, system: opts.system, code: opts.code }); out(opts.json, r, r.matches.map((m) => `${m.targetSystem}|${m.targetCode}`).join('\n') || '(no matches)'); return r.result ? 0 : 1; }
  finally { await ctx.close(); }
}
