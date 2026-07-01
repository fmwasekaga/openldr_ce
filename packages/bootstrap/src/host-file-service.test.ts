import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHostFileService } from './host-file-service';

let root: string;
let svc: ReturnType<typeof createHostFileService>;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-svc-'));
  svc = createHostFileService({ enabled: true, root, maxBytes: 1024 });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('host file service', () => {
  it('writes then reads bytes round-trip', async () => {
    await svc.hostFileWrite('out/x.bin', new Uint8Array([1, 2, 3]));
    const { bytes } = await svc.hostFileRead('out/x.bin');
    expect([...bytes]).toEqual([1, 2, 3]);
  });
  it('creates missing parent dirs on write', async () => {
    await svc.hostFileWrite('a/b/c.txt', new Uint8Array([9]));
    expect(fs.existsSync(path.join(root, 'a', 'b', 'c.txt'))).toBe(true);
  });
  it('lists directory entries', async () => {
    await svc.hostFileWrite('f1.txt', new Uint8Array([1]));
    fs.mkdirSync(path.join(root, 'd1'));
    const { entries } = await svc.hostFileList('');
    expect(entries.find((e) => e.name === 'f1.txt')).toMatchObject({ type: 'file', size: 1 });
    expect(entries.find((e) => e.name === 'd1')).toMatchObject({ type: 'dir' });
  });
  it('deletes a file but refuses a directory', async () => {
    await svc.hostFileWrite('del.txt', new Uint8Array([1]));
    await svc.hostFileDelete('del.txt');
    expect(fs.existsSync(path.join(root, 'del.txt'))).toBe(false);
    fs.mkdirSync(path.join(root, 'dd'));
    await expect(svc.hostFileDelete('dd')).rejects.toThrow(/refusing to delete a directory/);
  });
  it('enforces the size cap on read and write', async () => {
    await expect(svc.hostFileWrite('big.bin', new Uint8Array(2048))).rejects.toThrow(/exceeds/);
    fs.writeFileSync(path.join(root, 'big2.bin'), Buffer.alloc(2048));
    await expect(svc.hostFileRead('big2.bin')).rejects.toThrow(/exceeds/);
  });
  it('throws when disabled', async () => {
    const off = createHostFileService({ enabled: false, root, maxBytes: 1024 });
    await expect(off.hostFileRead('x')).rejects.toThrow(/disabled/);
  });
});
