# Plugin sandbox — security posture (P2-HARD-1)

OpenLDR CE runs ingestion plugins as **WebAssembly** modules through the
[Extism](https://extism.org/) host runtime (`@extism/extism@1.0.3`). This document
states, factually, what the sandbox does and does not enforce, so operators can make
an informed trust decision. The implementation lives in
`packages/plugins/src/extism-runner.ts`; the per-plugin manifest schema is in
`packages/plugins/src/manifest.ts`.

## What is enforced

### Default-deny filesystem and network
The runner instantiates each plugin **without** `allowedPaths` or `allowedHosts`
(both are left unset). With Extism, an unset allow-list means **no access**: a plugin
cannot open host files and cannot make network connections. There is no opt-in switch
in CE config to widen this — it is closed by construction.

### WASI is opt-in per plugin
`useWasi` is set from the plugin's own manifest (`opts.wasi`), defaulting to `false`
(`manifest.ts`: `wasi: z.boolean().default(false)`). A plugin only gets the WASI
preview-1 surface if its manifest explicitly requests it. Note: pure-Rust plugins
compiled to `wasm32-wasip1` still require `wasi:true` because the Rust standard
library imports `wasi_snapshot_preview1` symbols (clock/random) even for purely
in-memory work — so `wasi:true` here does **not** imply filesystem or network access
(those remain governed by the unset allow-lists above).

### Minimal host-function surface
The only host functions exposed to plugins are `log` and `progress`
(under `extism:host/user`). There is no host function granting syscalls, process
control, environment access, or arbitrary host callbacks. A plugin's entire
interaction with the host is: receive input bytes + an operator-supplied config map,
emit output bytes, and optionally call `log`/`progress`.

### Integrity: sha256 on install and on load
A plugin's wasm is sha256-checked against its manifest's `wasmSha256` at **install**
time and **re-verified on every load** from blob storage before instantiation. A
tampered or corrupted artifact is rejected, not run.

### Strict output validation
Plugin output is NDJSON (one FHIR resource per line). Each resource is re-validated
against the CE FHIR schemas strictly before it is persisted — a plugin cannot inject
an unvalidated or malformed resource into the warehouse.

### In-process, not worker-isolated
The runner uses `runInWorker: false`. The 1.0.3 SDK's worker path bootstraps from an
inline `data:` URL whose bundle references a relative `worker.js.map`, which Node
cannot resolve (`ERR_INVALID_URL`) — a known SDK bug. The plugin therefore runs in
the host process. This is relevant to the limits gap below.

## What is NOT enforced — the known gap

**Memory and CPU/time limits are recorded but not hard-enforced.**

The manifest carries `limits: { memoryMb: 256, timeoutMs: 30000 }`
(`manifest.ts`), but the `@extism/extism@1.0.3` JavaScript SDK exposes **no
memory-page cap and no hard-timeout option**:

- **`memoryMb` is advisory only.** It is stored in the manifest and surfaced to
  operators, but nothing in the runner caps the plugin's memory. A plugin that
  allocates without bound can grow until the host process is OOM-killed.
- **`timeoutMs` is a cooperative watchdog, not a hard kill.** The runner races the
  plugin call against a `setTimeout`-backed rejection
  (`Promise.race([plugin.call(...), timeout])`). This bounds an *asynchronous*
  overrun (the host stops awaiting and rejects), but because the plugin runs
  in-process with no worker, the watchdog **cannot interrupt a synchronous runaway**:
  a plugin spinning in a tight CPU loop never yields, so the timer callback never
  fires until the loop returns. The wasm keeps running.

### Operator guidance
Treat plugin installation as a privileged, trusted operation:

- **Only install plugins you have authored or audited.** A malicious or buggy plugin
  can consume CPU and memory until the host process dies (a denial-of-service against
  the ingest worker). It cannot read your filesystem, reach the network, or emit
  unvalidated data — but it can hang or exhaust the process it runs in.
- Run the ingest worker under an OS-level resource governor (cgroup memory/CPU limits,
  a container memory cap, a process supervisor that restarts on OOM) as defence in
  depth against a runaway plugin, since the runtime cannot cap it.
- Plugin installation is audited (`plugin.install` / `plugin.remove` audit events)
  and integrity-checked (sha256), so the *provenance* of what runs is recorded even
  though its *resource use* is not bounded.

### Upgrade path
Hard memory + interruptible-timeout enforcement requires a newer Extism SDK that
supports per-plugin memory limits and a worker/cancellation path on Node. When such a
version is adopted, `extism-runner.ts` should pass `limits.memoryMb`/`limits.timeoutMs`
through to the runtime and re-enable `runInWorker` so the timeout becomes a hard kill.
Until then, this gap is a tracked carry-forward.
