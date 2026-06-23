import { parseIndex, type MarketplaceIndex } from './index-json';

const API = 'https://api.github.com';

export interface RepoCoords {
  owner: string;
  repo: string;
  baseBranch: string;
  token: string;
}

export class PublishError extends Error {
  constructor(public kind: 'no-token' | 'repo-unreachable' | 'version-exists' | 'network', message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

function headers(token: string, raw = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Fetch + parse index.json at the base branch. Returns null on 404 (first publish seeds it). */
export async function fetchRepoIndexJson(repo: RepoCoords, fetchImpl: typeof fetch = fetch): Promise<MarketplaceIndex | null> {
  const res = await fetchImpl(`${API}/repos/${repo.owner}/${repo.repo}/contents/index.json?ref=${repo.baseBranch}`, { headers: headers(repo.token, true) });
  if (res.status === 404) return null;
  if (!res.ok) throw new PublishError('repo-unreachable', `index.json: HTTP ${res.status}`);
  return parseIndex(JSON.parse(await res.text()));
}

/** True if <path> already exists on the base branch. */
export async function repoPathExists(repo: RepoCoords, path: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(`${API}/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.baseBranch}`, { headers: headers(repo.token, true) });
  if (res.status === 404) return false;
  if (!res.ok) throw new PublishError('repo-unreachable', `${path}: HTTP ${res.status}`);
  return true;
}

export interface OpenPrArgs extends RepoCoords {
  files: { path: string; bytes: Uint8Array }[]; // bundle files — all committed as base64 blobs
  indexJson: string;                            // merged index.json (utf-8)
  branchName: string;
  prTitle: string;
  prBody: string;
}

/** Create a branch with one commit (bundle files + merged index.json) and open a PR. */
export async function openBundlePr(a: OpenPrArgs, fetchImpl: typeof fetch = fetch): Promise<{ prUrl: string; prNumber: number }> {
  const base = `${API}/repos/${a.owner}/${a.repo}`;
  const gh = async (path: string, init?: RequestInit): Promise<any> => {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers(a.token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { const b = (await res.json()) as { message?: string }; if (b?.message) message = b.message; } catch { /* ignore */ }
      throw new PublishError(res.status === 401 || res.status === 403 || res.status === 404 ? 'repo-unreachable' : 'network', message);
    }
    return res.json();
  };

  const ref = await gh(`/git/ref/heads/${a.baseBranch}`);
  const baseSha: string = ref.object.sha;
  const baseCommit = await gh(`/git/commits/${baseSha}`);
  const baseTreeSha: string = baseCommit.tree.sha;

  const mkBlob = async (bytes: Uint8Array): Promise<string> => {
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }) });
    return blob.sha as string;
  };

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (const f of a.files) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: await mkBlob(f.bytes) });
  tree.push({ path: 'index.json', mode: '100644', type: 'blob', sha: await mkBlob(new TextEncoder().encode(a.indexJson)) });

  const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTreeSha, tree }) });
  const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: a.prTitle, tree: newTree.sha, parents: [baseSha] }) });
  // Create the branch; if a prior failed publish left it behind, force-update it instead of erroring.
  try {
    await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${a.branchName}`, sha: commit.sha }) });
  } catch (err) {
    if (err instanceof PublishError && /already exists/i.test(err.message)) {
      await gh(`/git/refs/heads/${a.branchName}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: true }) });
    } else {
      throw err;
    }
  }
  const pr = await gh('/pulls', { method: 'POST', body: JSON.stringify({ title: a.prTitle, head: a.branchName, base: a.baseBranch, body: a.prBody }) });
  return { prUrl: pr.html_url as string, prNumber: pr.number as number };
}
