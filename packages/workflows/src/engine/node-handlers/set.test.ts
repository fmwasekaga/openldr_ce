import { describe, it, expect } from 'vitest';
import { setHandler } from './set';
import { createContext } from '../execution-context';

const node = (fields: Array<{ name: string; value: string }>, keepExisting = false) => ({
  id: 's1',
  type: 'set',
  data: { config: { fields, keepExisting } },
});

function ctx() {
  return createContext(undefined, () => {});
}

describe('setHandler', () => {
  it('maps fields from input item json via template', async () => {
    const result = await setHandler(
      node([{ name: 'b', value: '{{ $json.a }}' }]),
      ctx(),
      [{ json: { a: 1 } }],
    );
    expect(result).toEqual([{ json: { b: '1' } }]);
  });

  it('keepExisting true preserves existing fields', async () => {
    const result = await setHandler(
      node([{ name: 'b', value: '{{ $json.a }}' }], true),
      ctx(),
      [{ json: { a: 1 } }],
    );
    expect(result).toEqual([{ json: { a: 1, b: '1' } }]);
  });

  it('keepExisting false drops existing fields', async () => {
    const result = await setHandler(
      node([{ name: 'b', value: 'hello' }], false),
      ctx(),
      [{ json: { a: 1 } }],
    );
    expect(result).toEqual([{ json: { b: 'hello' } }]);
  });

  it('produces one output item per input item', async () => {
    const result = await setHandler(
      node([{ name: 'x', value: '{{ $json.n }}' }]),
      ctx(),
      [{ json: { n: 1 } }, { json: { n: 2 } }],
    );
    expect(result).toEqual([{ json: { x: '1' } }, { json: { x: '2' } }]);
  });

  it('empty input yields one item from empty base', async () => {
    const result = await setHandler(
      node([{ name: 'z', value: 'static' }]),
      ctx(),
      [],
    );
    expect(result).toEqual([{ json: { z: 'static' } }]);
  });

  it('skips fields with empty name', async () => {
    const result = await setHandler(
      node([{ name: '', value: 'ignored' }, { name: 'y', value: 'ok' }]),
      ctx(),
      [{ json: {} }],
    );
    expect(result).toEqual([{ json: { y: 'ok' } }]);
  });
});
