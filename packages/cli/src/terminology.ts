import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createTerminologyContext } from '@openldr/bootstrap';
import { redactError } from './redact-error';

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
  } catch (err) { process.stderr.write(`terminology import failed: ${redactError(err)}\n`); return 1; }
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
  } catch (err) { process.stderr.write(`expand failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTerminologyTranslate(url: string, opts: { system: string; code: string; json: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { const r = await ctx.ops.translate({ mapUrl: url, system: opts.system, code: opts.code }); out(opts.json, r, r.matches.map((m) => `${m.targetSystem}|${m.targetCode}`).join('\n') || '(no matches)'); return r.result ? 0 : 1; }
  finally { await ctx.close(); }
}

export async function runPublisherList(opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.publishers.list();
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const p of rows) console.log(`${p.id}\t${p.name}\t${p.role}${p.seeded ? '\t(seeded)' : ''}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology publisher list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runPublisherCreate(name: string, opts: { role?: 'local' | 'external'; icon?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const p = await ctx.admin.publishers.create({ name, role: opts.role ?? 'local', icon: opts.icon ?? null });
    out(opts.json ?? false, p, `created publisher ${p.id} (${p.name})`);
    return 0;
  } catch (err) { process.stderr.write(`terminology publisher create failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runSystemList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.codingSystems.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const s of rows) console.log(`${s.systemCode}\t${s.systemName}\t${s.url ?? '—'}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology system list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runSystemCreate(code: string, name: string, opts: { url?: string; version?: string; publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const s = await ctx.admin.codingSystems.create({ systemCode: code, systemName: name, url: opts.url ?? null, systemVersion: opts.version ?? null, active: true, publisherId: opts.publisher ?? null });
    out(opts.json ?? false, s, `created code system ${s.id} (${s.systemCode})`);
    return 0;
  } catch (err) { process.stderr.write(`terminology system create failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runTermList(systemUrl: string, opts: { q?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const page = await ctx.admin.terms.search(systemUrl, { query: opts.q, limit: 100, offset: 0 });
    if (opts.json) console.log(JSON.stringify(page, null, 2));
    else for (const t of page.rows) console.log(`${t.code}\t${t.display ?? ''}\t${t.status}`);
    return 0;
  } catch (err) { process.stderr.write(`terminology term list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runValueSetList(opts: { publisher?: string; json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.admin.valueSets.list(opts.publisher);
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const v of rows) console.log(`${v.url}\t${v.title ?? v.name ?? 'â€”'}\t${v.status}\t${v.codeCount} codes`);
    return 0;
  } catch (err) { process.stderr.write(`terminology valueset list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
