import { describe, it, expect, vi } from 'vitest';
import { openBundlePr, fetchRepoIndexJson, repoPathExists, PublishError } from './github-publish';

const coords = { owner: 'o', repo: 'r', baseBranch: 'main', token: 't' };

describe('github-publish', () => {
  it('fetchRepoIndexJson returns null on 404 (seed case)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, text: async () => 'x' }) as unknown as Response);
    const idx = await fetchRepoIndexJson(coords, fetchImpl as unknown as typeof fetch);
    expect(idx).toBeNull();
  });

  it('fetchRepoIndexJson parses raw index json', async () => {
    const body = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [] });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => body }) as unknown as Response);
    const idx = await fetchRepoIndexJson(coords, fetchImpl as unknown as typeof fetch);
    expect(idx?.packages).toEqual([]);
  });

  it('repoPathExists is false on 404, true on 200', async () => {
    const f404 = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    expect(await repoPathExists(coords, 'bundles/x', f404 as unknown as typeof fetch)).toBe(false);
    const f200 = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
    expect(await repoPathExists(coords, 'bundles/x', f200 as unknown as typeof fetch)).toBe(true);
  });

  it('openBundlePr posts base64 blobs and returns the PR url/number', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, body });
      if (u.endsWith('/git/ref/heads/main')) return ok({ object: { sha: 'base' } });
      if (u.includes('/git/commits/base')) return ok({ tree: { sha: 'btree' } });
      if (u.endsWith('/git/blobs')) return ok({ sha: `blob-${calls.length}` });
      if (u.endsWith('/git/trees')) return ok({ sha: 'newtree' });
      if (u.endsWith('/git/commits')) return ok({ sha: 'newcommit' });
      if (u.endsWith('/git/refs')) return ok({ ref: 'refs/heads/x' });
      if (u.endsWith('/pulls')) return ok({ html_url: 'https://gh/pr/7', number: 7 });
      return { ok: false, status: 500, json: async () => ({ message: 'boom' }) } as unknown as Response;
    });
    const wasm = new Uint8Array([1, 2, 3]);
    const res = await openBundlePr({
      ...coords,
      files: [
        { path: 'bundles/demo-1/manifest.json', bytes: new TextEncoder().encode('{"a":1}') },
        { path: 'bundles/demo-1/plugin.wasm', bytes: wasm },
      ],
      indexJson: '{"schemaVersion":1}',
      branchName: 'publish/demo-1', prTitle: 'Publish demo 1', prBody: 'body',
    }, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ prUrl: 'https://gh/pr/7', prNumber: 7 });
    const blobBodies = calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => c.body);
    expect(blobBodies.length).toBe(3);
    expect(blobBodies.every((b) => b.encoding === 'base64')).toBe(true);
    expect(blobBodies.some((b) => b.content === Buffer.from(wasm).toString('base64'))).toBe(true);
  });

  it('openBundlePr force-updates the branch if it already exists', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: u, method });
      if (u.endsWith('/git/ref/heads/main')) return ok({ object: { sha: 'base' } });
      if (u.includes('/git/commits/base')) return ok({ tree: { sha: 'bt' } });
      if (u.endsWith('/git/blobs')) return ok({ sha: 'b' });
      if (u.endsWith('/git/trees')) return ok({ sha: 't' });
      if (u.endsWith('/git/commits')) return ok({ sha: 'c' });
      if (u.endsWith('/git/refs') && method === 'POST') return { ok: false, status: 422, json: async () => ({ message: 'Reference already exists' }) } as unknown as Response;
      if (u.includes('/git/refs/heads/') && method === 'PATCH') return ok({ ref: 'refs/heads/publish/demo-1' });
      if (u.endsWith('/pulls')) return ok({ html_url: 'https://gh/pr/11', number: 11 });
      return { ok: false, status: 500, json: async () => ({ message: 'x' }) } as unknown as Response;
    });
    const res = await openBundlePr({ ...coords, files: [], indexJson: '{}', branchName: 'publish/demo-1', prTitle: 't', prBody: 'b' }, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ prUrl: 'https://gh/pr/11', prNumber: 11 });
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/git/refs/heads/publish/demo-1'))).toBe(true);
  });

  it('openBundlePr throws PublishError(network) on a failed API call', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) as unknown as Response);
    await expect(openBundlePr({ ...coords, files: [], indexJson: '{}', branchName: 'b', prTitle: 't', prBody: 'b' }, fetchImpl as unknown as typeof fetch))
      .rejects.toBeInstanceOf(PublishError);
  });
});

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response;
}
