# OpenLDR Community Edition — Product Requirements Document
## Phase 3: Ecosystem & Extensibility

**Status:** Draft (Phases 1–2 ahead of it)
**Audience:** Claude Code (autonomous implementation) + maintainers
**Builds on:** Phases 1–2. All prior principles (DP-1…DP-7), stack, ports, plugin runtime, forms/reports, terminology, and the provenance/audit foundation carry forward.

---

## 1. Overview & Theme

Phase 3 turns OpenLDR CE from a deployable product into an **extensible platform**. The headline is a **marketplace** that distributes plugins, form templates, and report templates (with the model designed to accommodate terminology and mapping bundles too), backed by a security model built for running untrusted, third-party artifacts in production.

### Why this is the productized answer to v1
v1's core failure was uncontrolled change: vendors modified the system directly, with no record of who changed what. The marketplace inverts that. Every extension is a **signed, versioned, permission-scoped, audited artifact**. Nothing enters a running deployment anonymously or with more access than it declared. Extensibility and accountability are delivered by the same mechanism.

### Design stance
The marketplace is **local-first**: every deployment has its own registry and works fully offline / air-gapped (a hard requirement for sovereignty-sensitive Ministry environments). Federation to a central public catalog is **optional** and additive — never a dependency.

---

## 2. Functional Requirements

### 2.1 Artifact & manifest model (P3-ART)
- **P3-ART-1** A common artifact model covering, in Phase 3: **plugins** (Extism/WASM), **form templates** (FHIR Questionnaire/SDC), and **report templates**. The model is extensible so terminology bundles (ValueSet/ConceptMap) and DHIS2 mapping bundles can be added later without redesign.
- **P3-ART-2** Each artifact carries a **manifest**: id, type, semantic version, author/publisher, target CE version range (compatibility), declared **capabilities/permissions** requested, dependencies, and a signature.
- **P3-ART-3** Artifacts are self-contained bundles installable from a local file (offline) or a registry.

### 2.2 Trust & security (P3-SEC) — the spine
- **P3-SEC-1** **Signing & verification:** every artifact is signed by its publisher; signatures and integrity hashes are verified on install. Tampered or unsigned artifacts are rejected (or gated behind an explicit override for local development).
- **P3-SEC-2** **Capability-based permissions:** a plugin's manifest declares the host capabilities it needs (e.g. read input, emit FHIR, network egress on/off, data-scope limits). The Phase 1 Extism sandbox enforces **only** the granted capabilities at runtime — a plugin cannot exceed its manifest.
- **P3-SEC-3** **Consent on install:** installing an artifact surfaces its requested capabilities for explicit admin approval. Grants are recorded.
- **P3-SEC-4** **Compatibility gate:** artifacts incompatible with the running CE version cannot be installed.
- **P3-SEC-5** **Lifecycle audit:** install, update, enable/disable, and remove events — and which version is active — are written to the audit log (DP-3), tying extension changes to an accountable actor.

### 2.3 Local registry & lifecycle (P3-REG)
- **P3-REG-1** A per-deployment registry that works offline: install, update, roll back, enable/disable, and cleanly remove artifacts.
- **P3-REG-2** Installed plugins register with the runtime; installed form templates become available in the forms engine; installed report templates become available in reporting — without a rebuild.
- **P3-REG-3** Version management: multiple versions resolvable; safe update and rollback; dependency resolution per manifest.

### 2.4 Publishing & developer experience (P3-PUB)
- **P3-PUB-1** Publish flow: package an artifact + manifest, sign it, publish to the local registry and/or (optionally) a central catalog.
- **P3-PUB-2** **Scaffolding CLI** for authors: `plugin new`, `form new`, `report new` generate a working artifact skeleton with manifest.
- **P3-PUB-3** **Local test harness**: authors can build and run an artifact against a dev instance before publishing (exercises the sandbox + capability grants). Agent-operable so Claude Code can scaffold, build, and test artifacts end to end (DP-4).

### 2.5 Marketplace UI (P3-UI)
- **P3-UI-1** Browse / search / filter artifacts by type, compatibility, and publisher, in the SPA (shadcn, themed via `DESIGN.md`).
- **P3-UI-2** Artifact detail view: manifest, requested capabilities, version history, signature/publisher status.
- **P3-UI-3** Install/update/remove with the capability-consent step; admin-gated.
- **P3-UI-4** "Installed" management view: active versions, enable/disable, rollback.

### 2.6 Optional federation (P3-FED) — see Open Decisions
- **P3-FED-1** Optional thin sync from a central public catalog: discover and pull published artifacts when connected. Strictly additive; the platform is fully functional with federation disabled.
- **P3-FED-2** Pulled artifacts go through the same signing/verification/consent path as local installs.

---

## 3. CLI Additions (agent-operable, all support `--json`)

- `plugin new | form new | report new` (scaffold)
- `artifact build | test | sign | publish`
- `market install <bundle|id> | update | rollback | remove | list`
- `market search` (local; central if federation enabled)
- `market verify <artifact>` (signature + capability report)

---

## 4. Non-Functional Requirements

- **P3-NFR-1 Offline-first marketplace:** full install/manage lifecycle works air-gapped from a local bundle; federation is the only part that needs connectivity.
- **P3-NFR-2 Sandbox enforcement:** a plugin can never exceed its granted capabilities; verified by security tests including a deliberately over-reaching test plugin.
- **P3-NFR-3 Integrity:** unsigned/tampered artifacts are rejected on install outside explicit dev override.
- **P3-NFR-4 Clean lifecycle:** install/update/rollback/remove leave no orphaned state; reversible.
- **P3-NFR-5 Auditability & portability:** the installed-artifact set (with versions and grants) is auditable and exportable (DP-2, DP-3).
- **P3-NFR-6 i18n + Playwright:** marketplace UI fully localized (en/fr/pt) with E2E coverage.

---

## 5. Deferred Beyond Phase 3

### Demand-triggered (build when a real deployment requires it — not scheduled)
- **Kafka / Inngest** eventing adapters — when throughput proves it (behind the existing port).
- **Oracle** target-store adapter — when a client mandates Oracle.
- **Desktop wrapper** (Electron/Tauri) — when offline/desktop central use emerges.
- **FHIR R5** — when a partner requires it (schema-driven layer already accommodates).

### Candidate dedicated future phase
- **Phase 4 — Intelligence:** AI/agentic services (echoing the v2 FastAPI + llama.cpp + MCP work): local/edge inference, MCP-exposed tools over the FHIR/warehouse data, assisted mapping and data-quality detection. Substantial enough to be its own phase rather than a marketplace add-on.

---

## 6. Open Decisions

- **Central catalog:** does a public central catalog exist in Phase 3, and who hosts/moderates it? Proposed: Phase 3 builds the local-first registry fully; central federation is a thin optional sync, with hosting/governance treated as a separate org decision. Confirm scope.
- **Signing / trust model:** publisher self-signed keys with admin-approve-on-install (trust-on-first-use), or a central verifying authority? Proposed: publisher-signed + consent for local-first; publisher verification added later if a central catalog launches.
- **Monetization:** the AGPL-core / permissive-SDK boundary already permits proprietary plugins. Does the marketplace host commercial artifacts, and if so does Phase 3 include any payment/licensing-key machinery? Proposed: allow any-license artifacts, no payment infrastructure in Phase 3.
- **Artifact types in Phase 3:** plugins/forms/reports are core. Include terminology and DHIS2-mapping bundles now (the model accommodates them), or defer?
- **Capability granularity:** confirm the capability set exposed to plugins (input read, FHIR emit, network egress, data scope) and how fine-grained data-scope limits need to be.

---

## 7. Suggested Build Sequence

1. **Artifact model + manifest + signing/verification + capability model** (P3-ART, P3-SEC) — security-first foundation; nothing else is safe without it.
2. **Local registry & lifecycle** with sandbox capability enforcement (P3-REG).
3. **Publish flow + scaffolding CLI + local test harness** (P3-PUB).
4. **Marketplace UI** (P3-UI).
5. **Lifecycle audit integration** (P3-SEC-5).
6. **Optional federation** to a central catalog (P3-FED) — if in scope.

---

## 8. Phase 1–2 Preconditions

Phase 3 assumes: a mature Extism/WASM plugin runtime with an enforceable host-function/capability interface (Phase 1); the forms-from-templates engine and reporting templates (Phases 1–2); terminology (Phase 2, if terminology bundles are in scope); and the CLI + Playwright harness + provenance/audit foundation.

---

## IP Boundary (carries over from Phase 1 §10)

OpenLDR CE is company-owned and AGPL-licensed; the plugin SDK is permissively licensed so third parties may publish artifacts under their own terms, including proprietary, across the arm's-length WASM boundary. Corlix remains a separate, personally-owned design reference — reimplement, never copy.
