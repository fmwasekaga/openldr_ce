import { describe, it, expect } from 'vitest';
import { newBlock, addRowWithBlock, moveRow, setColSpan, updateBlockAt, removeCell, previewLayoutModel, duplicateRow, moveRowFromCellDrag } from './reportBuilderModel';
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

function twoRows() {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('title'));
  t = addRowWithBlock(t, newBlock('divider'));
  return t;
}

describe('duplicateRow', () => {
  it('inserts a deep clone with a fresh id right after the row', () => {
    const t = twoRows();
    const out = duplicateRow(t, 0);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[1].cells[0].block.kind).toBe('title');
    expect(out.rows[1].id).not.toBe(t.rows[0].id);
    expect(out.rows[0].id).toBe(t.rows[0].id);
  });
  it('is a deep clone (mutating the copy does not touch the original)', () => {
    const t = twoRows();
    const out = duplicateRow(t, 0);
    (out.rows[1].cells[0].block as { text: string }).text = 'changed';
    expect((t.rows[0].cells[0].block as { text: string }).text).toBe('');
  });
  it('returns the template unchanged for an out-of-range index', () => {
    const t = twoRows();
    expect(duplicateRow(t, 5)).toBe(t);
  });
});

describe('moveRowFromCellDrag', () => {
  it('reorders rows from cell drag ids', () => {
    const t = twoRows();
    const out = moveRowFromCellDrag(t, 'cell:1:0', 'cell:0:0');
    expect(out).not.toBeNull();
    expect(out!.rows[0].cells[0].block.kind).toBe('divider');
  });
  it('returns null for same-row, non-cell, or missing over', () => {
    const t = twoRows();
    expect(moveRowFromCellDrag(t, 'cell:0:0', 'cell:0:1')).toBeNull();
    expect(moveRowFromCellDrag(t, 'palette:title', 'cell:0:0')).toBeNull();
    expect(moveRowFromCellDrag(t, 'cell:0:0', null)).toBeNull();
  });
});
