import { describe, it, expect } from 'vitest';
import { newBlock, addRowWithBlock, moveRow, setColSpan, updateBlockAt, removeCell, previewLayoutModel } from './reportBuilderModel';
import { createEmptyTemplate } from '@openldr/report-builder/pure';

describe('reportBuilderModel', () => {
  it('newBlock creates a schema-shaped block per kind', () => {
    expect(newBlock('title')).toMatchObject({ kind: 'title', text: '' });
    expect(newBlock('divider')).toEqual({ kind: 'divider' });
    expect(newBlock('table')).toMatchObject({ kind: 'table', source: 'primary' });
    expect(newBlock('chart')).toMatchObject({ kind: 'chart', chartType: 'bar' });
  });

  it('addRowWithBlock appends a full-width row', () => {
    const t = createEmptyTemplate('rt', 'R');
    const next = addRowWithBlock(t, newBlock('title'));
    expect(next.rows.length).toBe(1);
    expect(next.rows[0].cells[0].colSpan).toBe(12);
    expect(next.rows[0].cells[0].block.kind).toBe('title');
    expect(t.rows.length).toBe(0); // immutable
  });

  it('moveRow reorders', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    t = addRowWithBlock(t, newBlock('divider'));
    const moved = moveRow(t, 1, 0);
    expect(moved.rows[0].cells[0].block.kind).toBe('divider');
  });

  it('setColSpan clamps to 1..12', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    expect(setColSpan(t, 0, 0, 6).rows[0].cells[0].colSpan).toBe(6);
    expect(setColSpan(t, 0, 0, 99).rows[0].cells[0].colSpan).toBe(12);
    expect(setColSpan(t, 0, 0, 0).rows[0].cells[0].colSpan).toBe(1);
  });

  it('updateBlockAt patches a block', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    const next = updateBlockAt(t, 0, 0, { text: 'Hi' } as never);
    expect((next.rows[0].cells[0].block as any).text).toBe('Hi');
  });

  it('removeCell drops the cell (and the row if empty)', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    expect(removeCell(t, 0, 0).rows.length).toBe(0);
  });

  it('previewLayoutModel yields a LayoutModel with the page + one layout row per template row', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    const lm = previewLayoutModel(t);
    expect(lm.page.size).toBe(t.page.size);
    expect(lm.rows.length).toBe(1);
    expect(lm.rows[0].cells[0].kind).toBe('title');
  });

  it('previewLayoutModel uses a supplied table row count over the sample default', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('table'));
    const lm = previewLayoutModel(t, { '0:0': 9 });
    expect(lm.rows[0].cells[0].rowCount).toBe(9);
  });
});
