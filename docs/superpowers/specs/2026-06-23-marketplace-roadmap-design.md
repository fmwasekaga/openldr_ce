# Marketplace Roadmap — Design (Decomposition Spec)

**Date:** 2026-06-23
**Status:** Approved (umbrella roadmap; each sub-project gets its own spec → plan → build cycle)
**Topic:** Evolve the OpenLDR CE marketplace from a local-folder, plugin-only install harness
into a remote, signed, capability-scoped marketplace with a corlix-style browse/detail UX,
multi-kind artifacts, and in-app publishing.

---

## 0. Why this document exists

This is a **decomposition spec**, not an implementation spec. It records:

- where the marketplace is **today** (and why the GitHub repo looks empty),
- the agreed **target end state**,
- the **shared foundation** built once and reused,
- the **three sub-projects** (A/B/C), their ordering, and dependencies,
- the **open decisions / risks** each sub-project's own spec must resolve.

Each of A / B / C will get its own `docs/superpowers/specs/*-design.md` and
`docs/superpowers/plans/*.md` before implementation.

---

## 1. Current state (as of 2026-06-23)

Established by reading the code during brainstorming:

- **`whonet-sqlite` is a reference plugin that lives inside this repo** at
  `reference-plugins/whonet-sqlite/` — a WASM plugin converting a WHONET SQLite DB →
  FHIR R4 AMR resources.
- The marketplace "Available" list does **not** read from GitHub. `apps/server/src/marketplace-routes.ts`
  (`GET /api/marketplace/available`) does a `readdir` over a **local folder**,
  `MARKETPLACE_REGISTRY_DIR`.
- `pnpm make:marketplace-bundle` (`scripts/make-marketplace-bundle.ts`) signs the reference
  plugin and writes two bundles (`whonet-narrow` v1.0.0, `whonet-wide` v1.1.0) into the
  **local clone** `../openldr-ce-marketplace/bundles/`. Those bundles exist on disk locally but
  were **never `git push`ed** — hence the GitHub repo `fmwasekaga/openldr-ce-marketplace`
  appears empty. The entire current flow is local-filesystem only (a TOFU/signing
  live-acceptance harness), not a real remote registry.
- The UI (`apps/web/src/pages/settings/Marketplace.tsx`) is two flat tables (Available /
  Installed). There is **no detail view**. Install is **hard-disabled for any `type !== 'plugin'`**,
  so the `form-template` / `report` filter options are cosmetic.

### corlix reference (design source of truth)

- corlix's registry is git-backed with a remote `index.json`; the desktop app fetches it,
  shows a `PackageCard` grid + `PackageDetail` (with `PayloadPreview`, `RequirementsChecklist`),
  supports `kind ∈ { test-definition, form }`, scans for updates, detects drift via a canonical
  payload hash, and **publishes via the GitHub REST API with a user-supplied PAT** (no git binary,
  no Octokit — plain `fetch`: branch → blobs → tree → commit → ref → PR). Packages are JSON text
  files at `packages/<id>/<version>.json`; signatures are an **optional** field.
- We deliberately **keep our stronger trust model** (Ed25519 signed bundles + capability consent +
  TOFU pinning) and adopt corlix's **distribution + UX** patterns. corlix's optional-signature
  model is a downgrade we will not take.

---

## 2. Target end state

A signed, capability-scoped, **remote** marketplace where:

1. The OpenLDR server reads a published `index.json` + bundles from
   `github.com/fmwasekaga/openldr-ce-marketplace` over **HTTPS** (raw.githubusercontent.com or
   GitHub Pages). Local-dir source stays supported for dev/offline.
2. The Settings → Marketplace UI shows a corlix-style **card grid + detail view**.
3. Admins can install **four artifact kinds**: `plugin` (WASM, exists today), `form`, `report`,
   `test-definition`.
4. Admins can **publish** new artifacts in-app via a GitHub PR (corlix parity, adapted to
   web/server).

---

## 3. Shared foundation (built once, used by all three sub-projects)

### 3.1 `index.json` schema (repo root of the marketplace repo)

```jsonc
{
  "schemaVersion": 1,
  "name": "OpenLDR CE Marketplace",
  "updatedAt": "<ISO-8601>",
  "packages": [
    {
      "id": "whonet-sqlite",
      "kind": "plugin",            // plugin | form | report | test-definition
      "latestVersion": "1.1.0",
      "publisher": "OpenLDR Reference Publisher",
      "category": "ingestion",
      "summary": "WHONET SQLite -> FHIR R4 AMR",
      "tags": ["amr", "whonet", "fhir"],
      "path": "bundles/whonet-wide",   // dir (plugin) or file (json kinds)
      "signatureFingerprint": "<key fingerprint>"
    }
  ]
}
```

### 3.2 Generalized bundle envelope (text payloads)

Today a bundle payload is WASM. Forms/reports/test-defs are JSON. The manifest already carries
`type` + `payload.kind`, so `packBundle` / `readBundle` / `verifyBundle` in `packages/marketplace`
are extended to **sign and carry a JSON payload** through the same Ed25519 envelope. One envelope,
four kinds, identical signature/capability machinery.

**Decision (approved):** JSON artifacts are signed too — uniform trust story across all kinds.

### 3.3 Capabilities per kind

- `plugin`: keeps `emit-fhir` / `net-egress`.
- JSON kinds gain declarative capabilities so the consent dialog stays meaningful for non-code
  artifacts — e.g. a form's `target-pages`, a report's `data-scopes`. Exact capability vocabulary
  per kind is finalized in each kind's C-phase spec.

---

## 4. Sub-projects, ordered

### B — Artifact details page  *(do first — smallest, immediate value)*

corlix-style `PackageCard` grid + `PackageDetail` view: description, publisher, version,
**capabilities-as-permissions**, a `RequirementsChecklist` (compatibility / `ceVersion`), and a
`PayloadPreview`. Built against the **current local registry + current `/api/marketplace/available`
shape**, so it ships before A exists. Directly resolves "I have no idea what whonet-sqlite does."

### A — Remote registry  *(do second — makes the GitHub repo real)*

- **Install side:** a `RegistrySource` abstraction that fetches `index.json` + referenced bundles
  over HTTPS, with an on-disk cache, a manual "refresh", and `verifyBundle` on every download.
  `MARKETPLACE_REGISTRY_DIR` is retained as a `local` source type for dev/offline.
- **Publish side (corlix parity):** in-app "Publish" via the GitHub REST API — build signed bundle
  → fetch current `index.json` → version-conflict check → merge index entry → branch / blob / tree
  / commit / PR. **This is the step that finally pushes content to the empty repo.**
- **web/server adaptation:** corlix runs this in an Electron main process with a local PAT. We are
  web/server, so the PAT is stored **server-side** (encrypted config, admin-only) and the server
  opens the PR on the admin's behalf. Resolving this cleanly is A's spec's primary job.

### C — Non-plugin artifact kinds  *(do third — largest backend surface)*

Per-kind **install lifecycle** (apply a form into the forms subsystem; a report into the reports
catalog/scheduling; a test-definition into terminology), per-kind **publish** (serialize the
in-app artifact → signed JSON bundle), and per-kind **detail preview**. Sub-phased:

- **C1 — form** (direct corlix parity; forms subsystem already exists)
- **C2 — report** (OpenLDR-specific; builds on the reports catalog/scheduling already shipped)
- **C3 — test-definition / terminology** (heaviest; corlix's model is rich and our terminology
  subsystem differs — scope may shrink; optional/last)

### Ordering rationale

B is independent and immediate. A defines the `index.json` that everything else flows through and
ends the "empty repo" confusion. C builds per-kind lifecycles on top of A's distribution.

---

## 5. Open decisions / risks (each owned by a later spec)

1. **Server-side PAT for publishing** (web app, not desktop): storage, scope, which roles may use
   it. Biggest divergence from corlix. → owned by **A**.
2. **Signing keys:** maintainer-only signing (private keys never on user machines) vs. allowing
   admins to publish self-signed artifacts that install under TOFU. Affects who can publish what. →
   owned by **A** (policy) + **C** (per-kind publish).
3. **WASM size over GitHub raw:** acceptable now; GitHub Releases-as-host is the escape hatch if
   bundles grow large. → revisit in **A**.
4. **test-definition ↔ terminology mapping:** corlix's test-definition (LOINC test + reference
   ranges + codings) does not map 1:1 onto our terminology subsystem; C3 scope may shrink. → owned
   by **C3**.

---

## 6. Non-goals (this roadmap)

- No implementation here — this document only decomposes and orders the work.
- No change to the existing plugin runtime, capability enforcement, or TOFU trust store beyond the
  envelope generalization in §3.2.
- No multi-source federation (multiple marketplace repos) — single source for now; deferred.

---

## 7. Deliverables per sub-project (later)

Each of A / B / C produces:

- its own `docs/superpowers/specs/<date>-marketplace-<x>-design.md`
- its own `docs/superpowers/plans/<date>-marketplace-<x>.md`
- implementation + tests, merged independently.

This roadmap is the umbrella that records the shared foundation, ordering, and the decisions above.
