import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWithinRoot } from './host-file-sandbox';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'hi');
  fs.mkdirSync(path.join(root, 'sub'));
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const ok = (userPath: string, mustExist: boolean) => resolveWithinRoot({ enabled: true, root, userPath, mustExist });

describe('resolveWithinRoot guards', () => {
  it('throws when disabled', () => {
    expect(() => resolveWithinRoot({ enabled: false, root, userPath: 'a.txt', mustExist: true })).toThrow(/disabled/);
  });
  it('throws when root is unset', () => {
    expect(() => resolveWithinRoot({ enabled: true, root: '', userPath: 'a.txt', mustExist: true })).toThrow(/not configured/);
  });
  it('throws when the root does not exist', () => {
    expect(() => resolveWithinRoot({ enabled: true, root: path.join(root, 'nope'), userPath: 'a.txt', mustExist: true })).toThrow(/does not exist/);
  });
  it('resolves a relative path inside the root', () => {
    expect(ok('a.txt', true)).toBe(fs.realpathSync(path.join(root, 'a.txt')));
  });
  it('allows the root itself', () => {
    expect(ok('', true)).toBe(fs.realpathSync(root));
  });
  it('rejects .. traversal', () => {
    expect(() => ok('../escape', false)).toThrow(/escapes the sandbox/);
    expect(() => ok('sub/../../escape', false)).toThrow(/escapes the sandbox/);
  });
  it('rejects an absolute path', () => {
    expect(() => ok(path.join(os.tmpdir(), 'x'), false)).toThrow(/escapes the sandbox/);
  });
  it('rejects a not-found path when mustExist', () => {
    expect(() => ok('missing.txt', true)).toThrow(/not found/);
  });
  it('resolves a new file for write (parent exists, tail does not)', () => {
    const p = ok('sub/new.txt', false);
    expect(p).toBe(path.join(fs.realpathSync(path.join(root, 'sub')), 'new.txt'));
  });
  it('resolves a new file whose parent dirs do not exist yet', () => {
    const p = ok('deep/newer/file.txt', false);
    expect(p.startsWith(fs.realpathSync(root))).toBe(true);
  });
});

describe('resolveWithinRoot symlink escape', () => {
  it('rejects an in-root symlink pointing outside (read)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rwf-out-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'sensitive');
    const link = path.join(root, 'link');
    try { fs.symlinkSync(outside, link, 'dir'); } catch { return; } // skip if symlinks not permitted
    try {
      expect(() => resolveWithinRoot({ enabled: true, root, userPath: 'link/secret.txt', mustExist: true })).toThrow(/escapes the sandbox/);
    } finally {
      fs.rmSync(link, { force: true }); fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
