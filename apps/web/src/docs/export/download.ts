import type { DocSection } from '../registry';
import { sectionToMarkdown, manualToMarkdown } from './toMarkdown';

export type ExportScope = 'page' | 'all';
export type ExportFormat = 'md' | 'pdf' | 'docx';

export interface ExportRequest {
  scope: ExportScope;
  format: ExportFormat;
  active: DocSection;
  all: DocSection[];
}

const EXT: Record<ExportFormat, string> = { md: 'md', pdf: 'pdf', docx: 'docx' };

/** Trigger a browser download of a blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build the export blob for the request and hand it to `save` (default: saveBlob).
 * pdf/docx emitters are dynamically imported only when that format is requested.
 */
export async function exportDocs(
  req: ExportRequest,
  save: (blob: Blob, filename: string) => void = saveBlob,
): Promise<void> {
  const isAll = req.scope === 'all';
  const title = isAll ? 'OpenLDR Documentation' : req.active.title;
  const baseName = isAll ? 'openldr-documentation' : `openldr-${req.active.slug}`;
  const markdown = isAll ? manualToMarkdown(req.all) : sectionToMarkdown(req.active);
  if (!markdown.trim()) return;

  if (req.format === 'md') {
    save(new Blob([markdown], { type: 'text/markdown' }), `${baseName}.${EXT.md}`);
    return;
  }
  if (req.format === 'pdf') {
    const { renderPdf } = await import('./toPdf');
    save(await renderPdf(title, markdown), `${baseName}.${EXT.pdf}`);
    return;
  }
  const { renderDocx } = await import('./toDocx');
  save(await renderDocx(title, markdown), `${baseName}.${EXT.docx}`);
}
