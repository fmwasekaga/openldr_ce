import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ResolveOpts {
  enabled: boolean;
  root: string;
  userPath: string;
  /** true for read/list/delete (target must exist); false for write (may not exist). */
  mustExist: boolean;
}

const isWin = process.platform === 'win32';

/** Is `candidate` the root itself or strictly inside it? win32 compares case-insensitively. */
function within(root: string, candidate: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const c = isWin ? candidate.toLowerCase() : candidate;
  const r = isWin ? root.toLowerCase() : root;
  const p = isWin ? prefix.toLowerCase() : prefix;
  return c === r || c.startsWith(p);
}

/**
 * Resolve `userPath` to a safe absolute path inside the sandbox root, or throw.
 * The single choke-point for all host file operations.
 */
export function resolveWithinRoot(opts: ResolveOpts): string {
  if (!opts.enabled) throw new Error('Read/Write File: host file access is disabled');
  if (!opts.root) throw new Error('Read/Write File: WORKFLOW_FILE_ACCESS_ROOT is not configured');

  let canonicalRoot: string;
  try { canonicalRoot = fs.realpathSync(opts.root); }
  catch { throw new Error(`Read/Write File: sandbox root does not exist: ${opts.root}`); }

  const up = opts.userPath ?? '';
  if (path.isAbsolute(up)) throw new Error('Read/Write File: path escapes the sandbox root');
  if (up.split(/[\\/]/).some((seg) => seg === '..')) throw new Error('Read/Write File: path escapes the sandbox root');

  const candidate = path.resolve(canonicalRoot, up);
  if (!within(canonicalRoot, candidate)) throw new Error('Read/Write File: path escapes the sandbox root');

  if (opts.mustExist) {
    let real: string;
    try { real = fs.realpathSync(candidate); }
    catch { throw new Error(`Read/Write File: not found: ${up}`); }
    if (!within(canonicalRoot, real)) throw new Error('Read/Write File: path escapes the sandbox root');
    return real;
  }

  // Write: realpath the DEEPEST EXISTING ancestor (guards against an escaping
  // symlinked parent). Non-existent tail segments can't be escaping symlinks.
  let existing = candidate;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let realExisting: string;
  try { realExisting = fs.realpathSync(existing); }
  catch { throw new Error('Read/Write File: path escapes the sandbox root'); }
  if (!within(canonicalRoot, realExisting)) throw new Error('Read/Write File: path escapes the sandbox root');
  const finalPath = path.join(realExisting, ...tail);
  if (!within(canonicalRoot, finalPath)) throw new Error('Read/Write File: path escapes the sandbox root');
  return finalPath;
}
