import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveBlob, exportDocs } from './download';
import type { DocSection } from '../registry';

const a: DocSection = { slug: 'overview', title: 'Overview', content: '# Overview\n\nA', localeUsed: 'en' };
const b: DocSection = { slug: 'dhis2', title: 'DHIS2', content: '# DHIS2\n\nB', localeUsed: 'en' };

describe('download', () => {
  beforeEach(() => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it('saveBlob triggers an anchor download with the given filename', () => {
    const click = vi.fn();
    const anchor = { click, href: '', download: '', rel: '' } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);
    saveBlob(new Blob(['x']), 'file.md');
    expect(anchor.download).toBe('file.md');
    expect(click).toHaveBeenCalled();
  });

  it('exports markdown for a single page without loading pdf/docx', async () => {
    const saved: { name: string; blob: Blob }[] = [];
    await exportDocs({ scope: 'page', format: 'md', active: a, all: [a, b] }, (blob, name) => saved.push({ blob, name }));
    expect(saved[0].name).toBe('openldr-overview.md');
    expect(await saved[0].blob.text()).toContain('# Overview');
  });

  it('exports all docs as markdown with both sections', async () => {
    const saved: { name: string; blob: Blob }[] = [];
    await exportDocs({ scope: 'all', format: 'md', active: a, all: [a, b] }, (blob, name) => saved.push({ blob, name }));
    expect(saved[0].name).toBe('openldr-documentation.md');
    const text = await saved[0].blob.text();
    expect(text).toContain('# Overview');
    expect(text).toContain('# DHIS2');
  });
});
