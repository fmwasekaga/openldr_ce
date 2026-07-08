import { describe, it, expect } from 'vitest';
import { listDesigns, deleteDesign } from './report-design';
import type { ReportDesign } from '@openldr/report-designer';

function design(id: string, name: string, extra: Partial<ReportDesign> = {}): ReportDesign {
  return {
    id,
    name,
    paper: 'A4',
    orientation: 'portrait',
    pages: [{ id: 'p1', elements: [] }],
    parameters: [],
    ...extra,
  };
}

function fakeStore(seed: ReportDesign[] = []) {
  const data = [...seed];
  return {
    list: async () => data,
    get: async (id: string) => data.find((d) => d.id === id),
    create: async (d: ReportDesign) => { data.push(d); return d; },
    update: async (id: string, d: ReportDesign) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
    remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    __data: data,
  };
}

describe('report-design CLI handlers', () => {
  it('listDesigns emits ids, names and page counts (text)', async () => {
    const out: string[] = [];
    const write = (s: string) => { out.push(s); };
    await listDesigns(fakeStore([design('rd1', 'Main')]) as any, { json: false }, write);
    const text = out.join('');
    expect(text).toContain('rd1');
    expect(text).toContain('Main');
    expect(text).toContain('1 pages');
  });

  it('listDesigns emits a placeholder when empty (text)', async () => {
    const out: string[] = [];
    await listDesigns(fakeStore() as any, { json: false }, (s) => out.push(s));
    expect(out.join('')).toContain('(no report designs)');
  });

  it('listDesigns emits JSON when --json', async () => {
    const out: string[] = [];
    await listDesigns(fakeStore([design('rd1', 'Main')]) as any, { json: true }, (s) => out.push(s));
    const parsed = JSON.parse(out.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('rd1');
  });

  it('deleteDesign requires force', async () => {
    const store = fakeStore([design('rd1', 'Main')]);
    await expect(deleteDesign(store as any, 'rd1', { force: false })).rejects.toThrow(/--force/);
    expect(store.__data.length).toBe(1);
    await deleteDesign(store as any, 'rd1', { force: true });
    expect(store.__data.length).toBe(0);
  });
});
