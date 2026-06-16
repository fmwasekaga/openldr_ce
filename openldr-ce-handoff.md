# Continue OpenLDR CE — Terminology Management UI (execute SP4: Ontology Browser)

You are taking over a multi-sub-project effort in the **OpenLDR CE** repo. Read this whole brief before doing anything.

## Repos & environment

- **Working repo:** `D:\Projects\Repositories\openldr_ce` — a pnpm + turbo TypeScript monorepo (`packages/db`, `packages/terminology`, `packages/bootstrap`, `packages/cli`, `apps/server`, `apps/web`, `e2e`). FHIR R4, AMR/lab surveillance domain.
- **Design source of truth:** `D:\Projects\Repositories\corlix` — a sibling Electron app. **Read-only.** Do not edit it. It is the UI/UX reference for everything in the Terminology page.
- **OS:** Windows 11, PowerShell. Use PowerShell syntax (`$null`, `$env:VAR`, backtick line-continuation). Bash is also available.
- **Gates (run from repo root):** `pnpm turbo typecheck lint test build` and `pnpm depcruise`. Both must be green before any merge.
- **Per-package test:** `pnpm --filter @openldr/<pkg> test -- <pattern>` (e.g. `pnpm --filter @openldr/db test -- 015_ontology`).

## What "copy exactly" means (the user will hold you to this)

corlix is the design source of truth. When the user says "copy exactly from corlix," it means:

1. **Read corlix's actual files FIRST** (layout, menus, sheets, component structure, cursors, behavior) before writing the CE version.
2. **Reimplement, do not literally copy:** corlix is Electron + SQLite + `window.api.*` IPC + i18n `t()`. CE is HTTP + Postgres/Kysely + a `fetch`-based `apps/web/src/api.ts` + English string literals. Adapt those layers, but **preserve the UX, layout, menu structure, and behavior verbatim.**
3. **Do not diverge from corlix's design without stating a reason.** If you must diverge (e.g. CE has no Electron folder picker, or a feature is deferred), say so explicitly in your message and/or a code comment — never silently.
4. Faithful ≠ pixel-copy of code: a user familiar with corlix's Terminology page should recognize CE's as the same product.

## Current state (already done — do NOT redo)

- **SP1** (Publishers + Code Systems), **SP2** (Terms + Mappings), and **SP3** (Value Sets + Value Set Builder) are fully implemented, tested, and **merged to `main`** (SP3 merge commit `22df8ec`). `main` is ahead of `origin/main` and has **not** been pushed — leave pushing to the user.
- The Terminology page is `apps/web/src/pages/Terminology.tsx` (publisher rail + breadcrumb + `⋯` kebab with Publisher / Code system / Term / Value set submenus + drill-in + value-set list/builder). corlix's equivalent is `apps/desktop/src/renderer/pages/TerminologyPage.tsx`.
- **SP4** (Ontology Browser, full corlix parity) is **already specced and planned** — your job is to **execute it**. No brainstorming needed; the design decisions are locked:
  - Spec: `docs/superpowers/specs/2026-06-15-terminology-ui-sp4-design.md`
  - Plan: `docs/superpowers/plans/2026-06-15-terminology-ui-sp4.md` (**18 tasks, T1–T18**, each with full code or precise port instructions + TDD steps)

## YOUR JOB: execute the SP4 plan, task by task

Open `docs/superpowers/plans/2026-06-15-terminology-ui-sp4.md` and implement it **in order, T1 → T18**. SP4 reimplements corlix's full ontology subsystem: a Postgres ontology index (`ontology_nodes`/`edges`/`distributions` + LOINC panels/answers/specimens), the three ported adapters (LOINC hierarchy / SNOMED IS-A / RxNorm ATC + relationship groups), a server-side build lifecycle with **SSE** progress + staleness, the browse/picker/distribution UI, and wiring the two currently-disabled "Browse ontology" affordances (the page kebab + the mapping dialog).

For **each** task, run this loop (mirrors how the previous agent worked — TDD + two-stage self-review + frequent commits):

1. **Read the task fully**, plus the files it touches and the corresponding corlix source it ports.
2. **Write the failing test first**, run it, confirm it fails for the expected reason.
3. **Implement** from the task. Several tasks (the three adapters T3–T5, the `OntologyBrowser`/`OntologyPickerDialog` ports T13–T14) say **"port the corlix file verbatim, applying ONLY these transforms."** Do exactly that: open the named corlix file and reproduce it with the listed mechanical changes (`window.api.*` → `api.ts` fns, `insertX(db,…)` → `writer.insertX(…)`, `t("…")` → English literals, drop `db.transaction` wrappers). Do not redesign ported code. CE-specific glue (migration, store, build orchestrator, routes, CLI, api client, dialogs, page wiring) has full inline code in the plan — use it.
4. **Run the test**, confirm it passes. Then run that package's full test + typecheck.
5. **Self-review in two passes before committing:**
   - _Spec compliance:_ does the code do exactly what the plan/spec says — nothing missing, nothing extra (no scope creep)?
   - _Code quality:_ matches surrounding style, no dead code, no swallowed errors, names consistent with earlier tasks.
   - Fix anything you find, re-run tests.
6. **Commit** with the message given in the task (keep the `(P2-TERM)` tag). End commit messages with:
   `Co-Authored-By: Codex <noreply@openai.com>` (or your own attribution line).
7. Move to the next task. **Do not stop to check in between tasks** unless you hit a genuine blocker or a decision the plan doesn't cover.

### Five places the plan deliberately says "verify before writing" — do these, don't guess:

- **T1 Step 1 — no expression index on pg-mem:** skip the `lower(display)` functional index in the migration (pg-mem can't build it); search works without it.
- **T8 Step 1 — `@openldr/db` ↔ `@openldr/terminology` import direction:** the ontology types live in `@openldr/terminology`; importing them into `@openldr/db`'s `ontology-store` may create a cycle. Run `pnpm depcruise`; if a cycle results, **duplicate the small row/`OntologyNode` types locally** in `ontology-store.ts` (the established precedent — `apps/web` duplicates types rather than cross a boundary). Record the choice in the T8 commit. Confirm acyclic in T18.
- **T10 Step 1 — Fastify SSE idiom:** the build/rebuild routes stream with `reply.hijack()` + `reply.raw`. Verify this against an existing streaming/download route in `apps/server` (e.g. the SP3 value-set export, or any CSV download) and match that idiom; if the app uses an SSE plugin, use it.
- **T12 Step 2 — EventSource base URL / Vite proxy:** build the `EventSource` URL with the same base `api.ts` uses, and confirm the Vite dev proxy forwards `/api` (including SSE) to the server.
- **T17 — stale notifier depends on a CE notification primitive:** grep for one (`notification`/`outbox`/`publishNotification`). If it exists, port corlix's `staleNotify.ts` to use it; if not, **skip the background notifier** — the distribution dialog's stale **banner** (wired in T14) is the must-have. Do NOT invent a notification system.

## Non-negotiable conventions (carried from SP1–SP3 — violating these will break things)

- **DP-1:** `apps/server` must **not** depend on `@openldr/db`. All DB access goes through `ctx` (e.g. `ctx.terminology.ontology.*`). Route error handling wraps messages in `redact(...)` and, for the admin store, uses a **duck-type guard** (`err.name === 'TerminologyAdminError' && typeof err.kind === 'string'`), never `instanceof`. See `apps/server/src/terminology-admin-routes.ts`.
- **Adapters write through an injected seam, not a DB:** corlix adapters call `insertNode(db, …)` into a SQLite sidecar. CE adapters call `writer.insertNode(…)` on an injected `IndexWriter`; a buffered writer in `build.ts` flushes to the Postgres `ontology-store` in chunks. Port the adapter *logic* verbatim — only the write target changes.
- **pg-mem quirks (tests):** no `ILIKE` (use `` sql`lower(x)` `` `like`); jsonb columns must be inserted as `JSON.stringify(...)`; **no correlated subqueries** — compute child counts with a separate grouped query (the plan's `childCounts` helper); cascade deletes aren't enforced, so `clearIndex`/`unlink` delete child rows explicitly; `db.transaction()` and `` sql`now()` `` work.
- **`db reset` is a no-op without `--force`.** For live Postgres reseeds use `... db reset --force`.
- **apps/web:** always use the shadcn/Radix primitives in `apps/web/src/components/ui/*` (Select/Button/Input/Dialog/DropdownMenu/Sheet/Badge…), **never** native `<select>` etc. Create a missing primitive rather than going native.
- The web layer **duplicates types** (`OntologyNode`, `OntologyDistribution`, etc.) in `apps/web/src/api.ts` rather than importing from `@openldr/db`/`@openldr/terminology` — intentional, because `apps/web` can't import those packages. Follow that pattern. (Note: name the web node-detail fn `ontologyNodeDetail` to avoid clashing with the DOM `Node` type.)

## SP4 build mechanism (a deliberate, stated divergence from corlix)

CE has no Electron native folder picker. An ontology index is built **server-side over an already-extracted distribution directory**:
- CLI: `terminology ontology build <codingSystemId> <dir>` registers + builds (also `rebuild`/`list`/`unlink`).
- The `OntologyDistributionDialog` shows status / node+edge counts and offers a **server-side path text input + Build**, plus **Rebuild** (recorded path) and **Unlink**. The path text field replaces corlix's native folder dialog — this is the one intentional UX divergence; it's noted in the spec and should be noted in a code comment.
- Build **streams progress over SSE** (`EventSource`), matching corlix's live `onBuildProgress` UX.

LOINC/SNOMED/RxNorm distributions are operator-provided (CE ships no bundled content — licensing). The committed `__fixtures__` (copied from corlix) are tiny synthetic samples that drive the adapter + build tests.

## Methodology (how the previous agent worked — emulate it)

You may not have the "superpowers" skill plugin. SP4 is already specced + planned, so you do **not** brainstorm — you execute. Just follow the per-task TDD + two-stage self-review + commit loop above, in order, continuously.

**If the user later asks for a brand-new sub-project** (beyond SP4): emulate the brainstorm→spec→plan→execute flow — explore corlix + CE first, ask the user one multiple-choice question at a time on scope/key decisions, write the spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (commit, ask them to review), then the plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` (bite-sized tasks, complete code, no placeholders), then execute. But that's only if asked — SP4 completes the Terminology Management UI.

**Working style:** prefer a feature branch for SP4. Frequent small commits. TDD always (test first). Don't relitigate decisions already in the spec/plan. When something is genuinely ambiguous or a decision is the user's to make, ask — but batch questions; the user's budget is limited, so only ask when you truly can't infer from corlix + the existing code + the plan.

## Finishing SP4

After T18 (e2e + live acceptance + gates + docs), verify all tests pass, then **merge SP4 to `main` locally** (`--no-ff`), exactly how SP1–SP3 were merged. Don't push to origin unless the user asks. SP4 completes the Terminology Management UI (SP1–SP4).

## Memory / log to keep updated

Human-maintained project log: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`. After SP4 merges, append a short entry (what shipped, key tables/files, decisions, what remains). Plain markdown; mirror the existing SP1/SP2/SP3 entry style.

## When to ask the user

The user has limited budget on the other tool but can give a little help. Ask when: (a) a verify-step reveals a plan assumption was wrong and the fix changes behavior, (b) `depcruise` reports a dependency cycle you can't resolve with the local-types fallback, (c) the SSE/Fastify streaming idiom doesn't match anything in the codebase, or (d) you're blocked on environment/credentials (e.g. no LOINC distribution dir for live acceptance — the fixtures cover tests, so live acceptance can be deferred to the user). Otherwise proceed autonomously and report progress.

**Start now:** confirm you've read the SP4 plan, then begin at Task 1.
```
