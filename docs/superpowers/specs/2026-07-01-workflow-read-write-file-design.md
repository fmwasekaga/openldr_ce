# Workflow `read-write-file` Node — Sandboxed Host Filesystem (Slice J)

**Date:** 2026-07-01
**Status:** Approved design
**Workstream:** Workflow node palette — the final placeholder.

## Goal

Implement the `read-write-file` node: read/write/list/delete real host files, but
strictly confined to an operator-configured sandbox directory, off by default.
This is the n8n "Read/Write Files from Disk" equivalent and the last remaining
palette placeholder.

It is distinct from the Slice-C binary nodes (convert/extract/spreadsheet), which
operate on the internal **blob artifact store** (`blob.get`/`put` under
`workflow-artifacts/`). This node touches the **host filesystem** — which is why
it is security-gated.

## Security model (the whole point)

- **Master switch** `WORKFLOW_FILE_ACCESS_ENABLED`, default **false** — mirrors
  `WORKFLOW_CODE_ENABLED` (host-privilege risk → opt-in). When off, every
  operation throws `host file access is disabled`.
- **Single sandbox root** `WORKFLOW_FILE_ACCESS_ROOT` (default `''`). Every path
  resolves within it; escapes are rejected. When enabled but unset → throw.
- **All FS access is confined to one pure choke-point** (`resolveWithinRoot`)
  that every operation calls first. The pure engine never touches the host FS —
  access is only via host-injected services.
- Size caps reuse `WORKFLOW_FILE_MAX_BYTES`.

## Non-goals (YAGNI)

- Glob / recursive operations.
- Directory create/remove (beyond write auto-creating parent dirs within the root).
- Append mode, chmod / permissions, file watching (that's listener triggers).
- Multiple roots / per-node root overrides (single operator root only).
- Recursive directory delete (delete is single-file `unlink` only).

## The security core — `host-file-sandbox.ts` (pure)

`resolveWithinRoot(opts: { enabled, root, userPath, mustExist }): string` — returns
the safe absolute path or throws. The single choke point:

1. If `!enabled` → throw `host file access is disabled`.
2. If `!root` (empty/unset) → throw `WORKFLOW_FILE_ACCESS_ROOT is not configured`.
3. `canonicalRoot = fs.realpathSync(root)` — the root must exist (defeats a
   symlinked root pointing elsewhere). Throw a clear error if the root is missing.
4. **Reject** a `userPath` that is absolute (`path.isAbsolute`) OR contains any
   `..` segment (defense-in-depth) → throw `path escapes the sandbox root`.
5. `candidate = path.resolve(canonicalRoot, userPath)`.
6. **Containment:** `candidate` must equal `canonicalRoot` or start with
   `canonicalRoot + path.sep`. On **win32 compare case-insensitively** (the FS is
   case-folding); elsewhere case-sensitive. Else throw `path escapes the sandbox
   root`.
7. **Symlink-escape guard:**
   - `mustExist` (read/list/delete): `real = fs.realpathSync(candidate)`; re-run
     the containment check on `real` (defeats an in-root symlink that targets
     outside). Return `real`.
   - not `mustExist` (write): `realParent = fs.realpathSync(path.dirname(candidate))`;
     containment-check `realParent`; return `path.join(realParent,
     path.basename(candidate))` (lets you create a new file, but not through an
     escaping symlinked parent).

The resolver takes `enabled`/`root` as arguments (not reading `cfg` directly) so
it is a pure, exhaustively-testable function.

## Host-FS services — `host-file-service.ts` (injected on `WorkflowServices`)

Four optional methods (like `readBinary`/`writeBinary`), each resolving via
`resolveWithinRoot` first. Constructed with `{ enabled: cfg.WORKFLOW_FILE_ACCESS_ENABLED,
root: cfg.WORKFLOW_FILE_ACCESS_ROOT, maxBytes: cfg.WORKFLOW_FILE_MAX_BYTES }`:

- `hostFileRead(p) → { bytes: Uint8Array }` — resolve(mustExist) → `fs.statSync`
  size ≤ `maxBytes` (throw if over) → `fs.readFileSync`.
- `hostFileWrite(p, bytes) → { byteSize }` — throw if `bytes.byteLength > maxBytes`
  → resolve(write) → `fs.mkdirSync(dirname, { recursive: true })` (parents within
  the root) → `fs.writeFileSync`.
- `hostFileList(p) → { entries: { name, type: 'file'|'dir', size }[] }` —
  resolve(mustExist) → `fs.readdirSync(..., { withFileTypes: true })` → map (size
  via `statSync` per entry; `type` from the dirent).
- `hostFileDelete(p) → { ok: true }` — resolve(mustExist) → if the target is a
  directory throw `refusing to delete a directory` → `fs.unlinkSync`.

Interface signatures added to `packages/workflows/src/engine/services.ts`:
```ts
  hostFileRead?(path: string): Promise<{ bytes: Uint8Array }>;
  hostFileWrite?(path: string, bytes: Uint8Array): Promise<{ byteSize: number }>;
  hostFileList?(path: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }>;
  hostFileDelete?(path: string): Promise<{ ok: true }>;
```

## Node handler — `node-handlers/read-write-file.ts` (`action: 'read-write-file'`)

Config `{ operation: 'read'|'write'|'list'|'delete', path, asText?, binaryField?, textContent? }`.
`path`/`textContent` are templated (`resolveTemplate`). Guards: the relevant
`ctx.services.hostFile*` absent → throw `Read/Write File requires server services`.

Operates **per input item** (path templates per item; an empty input runs once
with a single blank item):
- **read** → `hostFileRead(path)`; if `asText` → UTF-8 decode into
  `json[binaryField || 'content']`; else `writeBinary({ bytes, fileName:
  basename(path), contentType: 'application/octet-stream' })` → attach the
  `BinaryRef` to `item.binary[binaryField || 'file']`.
- **write** → bytes = `item.binary[binaryField || 'file']` (via `readBinary(objectKey)`)
  when present, else `Buffer.from(resolveTemplate(textContent))` → `hostFileWrite(path, bytes)`;
  pass the item through + `meta.byteSize`.
- **list** → `hostFileList(path)` → `json.entries = […]`.
- **delete** → `hostFileDelete(path)` → pass through + `meta.deleted = path`.

## Config knobs (`packages/config/src/schema.ts`)

- `WORKFLOW_FILE_ACCESS_ENABLED: envBoolean(false)`.
- `WORKFLOW_FILE_ACCESS_ROOT: z.string().default('')`.
- Reuses existing `WORKFLOW_FILE_MAX_BYTES`.

## Components / files

- Create `packages/bootstrap/src/host-file-sandbox.ts` (+ test) — pure resolver.
- Create `packages/bootstrap/src/host-file-service.ts` (+ test) — the 4 gated methods.
- Modify `packages/config/src/schema.ts` (+ test) — 2 knobs.
- Modify `packages/workflows/src/engine/services.ts` — 4 optional signatures.
- Modify `packages/bootstrap/src/index.ts` — construct the service + assign the 4
  methods onto `workflowServices`.
- Create `packages/workflows/src/engine/node-handlers/read-write-file.ts` (+ test)
  + register in `node-handlers/index.ts` `ACTION_HANDLERS`.
- Modify `apps/web/src/workflows/constants.ts` — `read-write-file` in
  `IMPLEMENTED_TEMPLATE_IDS` + palette default `{ action:'read-write-file',
  config: { operation:'read', path:'', asText:false } }`.
- Create `apps/web/src/workflows/components/node-forms/read-write-file-form.tsx`
  + register in `node-forms/index.tsx` FORMS.

## Data flow

```
item → read-write-file handler (validates config, guards services)
     → ctx.services.hostFile{Read|Write|List|Delete}(templatedPath, …)
         → resolveWithinRoot (enabled? root? traversal/symlink guards) → fs.*
     → read: writeBinary → BinaryRef on item.binary  |  write: readBinary → fs write
     → result/meta attached → downstream
```

## Error handling

`disabled`, `root not configured`, `path escapes the sandbox root` (`..`/absolute/
symlink), `not found`, size-cap exceeded, `refusing to delete a directory`, service
absent → descriptive throws; the node fails and the runner stops (as today).

## Testing

- **`host-file-sandbox.test.ts` (the critical unit — heaviest coverage):** a real
  temp dir as root — relative path resolves inside; `..`-escape rejected; absolute
  path rejected; a symlink inside root pointing outside is rejected (read path);
  `candidate === root` allowed; write path resolves via realpath-parent and allows
  a new file but rejects an escaping symlinked parent; disabled → throw; empty root
  → throw; missing root dir → throw. (win32 case-insensitive containment noted; the
  test is OS-aware.)
- **`host-file-service.test.ts`:** read/write/list/delete round-trip in a temp dir;
  size-cap on read + write; delete refuses a directory; disabled/root-unset throw
  (delegated to the resolver).
- **`read-write-file.test.ts` (engine):** each operation; `asText` vs binary read;
  write from a binary field vs `textContent`; service-absent guard; templated path.
- **`schema.test.ts`:** the 2 new knobs (default false / empty; overrides).
- **web:** the form renders operation-specific fields + writes config.
- **Gate:** config, workflows (services signature), bootstrap, server, web — tsc +
  tests.

## Decisions (resolved during brainstorming)

- Host filesystem (not the blob store), sandboxed to one operator root.
- Operations: read + write + list + delete (delete = single-file `unlink`,
  refuses directories).
- Read output: binary BinaryRef by default; `asText` toggle → UTF-8 into json.
- Master switch `WORKFLOW_FILE_ACCESS_ENABLED` default **false**.
- Write auto-creates missing parent dirs within the root.
- Single root; size caps reuse `WORKFLOW_FILE_MAX_BYTES`.
