import { describe, it, expect } from 'vitest';
import { listTemplates, exportTemplate, importTemplate, deleteTemplate, renderTemplateToFile, parseParams } from './report-template';
import { createEmptyTemplate } from '@openldr/report-builder/pure';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeStore(seed: any[] = []) {
  const data = [...seed];
  return {
    list: async () => data,
    get: async (id: string) => data.find((d) => d.id === id),
    create: async (d: any) => { data.push(d); return d; },
    update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
    remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    __data: data,
  };
}

describe('report-template CLI handlers', () => {
  it('listTemplates emits ids and names', async () => {
    const out: string[] = [];
    const write = (s: string) => { out.push(s); };
    await listTemplates(fakeStore([createEmptyTemplate('rt1', 'Main')]) as any, { json: false }, write);
    expect(out.join('')).toContain('rt1');
    expect(out.join('')).toContain('Main');
  });

  it('exportTemplate writes the JSON of a known template', async () => {
    const out: string[] = [];
    await exportTemplate(fakeStore([createEmptyTemplate('rt1', 'Main')]) as any, 'rt1', (s) => out.push(s));
    expect(JSON.parse(out.join('')).id).toBe('rt1');
  });

  it('exportTemplate throws on unknown id', async () => {
    await expect(exportTemplate(fakeStore() as any, 'nope', () => {})).rejects.toThrow(/not found/);
  });

  it('importTemplate creates a validated template from JSON', async () => {
    const store = fakeStore();
    const json = JSON.stringify(createEmptyTemplate('rt2', 'Imported'));
    await importTemplate(store as any, json);
    expect(store.__data.find((d) => d.id === 'rt2')?.name).toBe('Imported');
  });

  it('importTemplate rejects invalid JSON payloads', async () => {
    await expect(importTemplate(fakeStore() as any, '{"id":"x"}')).rejects.toThrow();
  });

  it('deleteTemplate requires force', async () => {
    const store = fakeStore([createEmptyTemplate('rt1', 'Main')]);
    await expect(deleteTemplate(store as any, 'rt1', { force: false })).rejects.toThrow(/--force/);
    expect(store.__data.length).toBe(1);
    await deleteTemplate(store as any, 'rt1', { force: true });
    expect(store.__data.length).toBe(0);
  });
});

describe('report-template render helpers', () => {
  it('parseParams splits k=v,k2=v2', () => {
    expect(parseParams('a=1,b=hello')).toEqual({ a: '1', b: 'hello' });
    expect(parseParams(undefined)).toEqual({});
  });

  it('renderTemplateToFile writes a PDF for a known template', async () => {
    const tpl = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
      page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
      parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi', style: {} } }] }] };
    const store = { get: async (id: string) => (id === 'rt1' ? tpl : undefined) } as any;
    const queryFn = async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'n', rowCount: 0 } });
    const out = join(tmpdir(), `rt-${Date.now()}.pdf`);
    await renderTemplateToFile(store, queryFn as any, 'rt1', {}, out);
    const buf = readFileSync(out);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    rmSync(out, { force: true });
  });

  it('renderTemplateToFile throws on unknown id', async () => {
    const store = { get: async () => undefined } as any;
    await expect(renderTemplateToFile(store, (async () => ({})) as any, 'nope', {}, 'x.pdf')).rejects.toThrow(/not found/);
  });
});
