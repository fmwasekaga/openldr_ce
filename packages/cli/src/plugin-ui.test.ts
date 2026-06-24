import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAdjacentUi } from './plugin';

describe('readAdjacentUi', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'cli-ui-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reads the ui.entry file from the manifest dir when declared', async () => {
    await writeFile(join(dir, 'ui.html'), '<div>panel</div>');
    const bytes = readAdjacentUi({ ui: { entry: 'ui.html' } }, dir);
    expect(bytes && new TextDecoder().decode(bytes)).toBe('<div>panel</div>');
  });

  it('returns undefined when the manifest declares no ui.entry', () => {
    expect(readAdjacentUi({}, dir)).toBeUndefined();
    expect(readAdjacentUi({ ui: {} }, dir)).toBeUndefined();
  });

  it('rejects a ui.entry that is not a plain filename (path traversal)', async () => {
    expect(() => readAdjacentUi({ ui: { entry: '../escape.html' } }, dir)).toThrow();
  });
});
