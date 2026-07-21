# Terminology upload — acceptance fixes + UX (Slice 4) — design

- **Date:** 2026-07-21
- **Status:** approved (brainstorm) → ready for implementation plan
- **Depends on:** Slices 1 / 1.1 / 2 / 3 (all merged local `main`; Slice 3 at `be819ef2` + follow-ups `f252c06d`).
- **Origin:** live acceptance testing of the containerized prod stack (`docker-compose.prod.yml`, project `openldr-slice3`). Six issues surfaced uploading real LOINC / SNOMED CT / RxNorm distributions. Root causes below were each confirmed against the running stack (logs, DB, MinIO), not inferred.

## 1. Motivation

The upload→ingest pipeline works for small/synthetic distributions but fails or under-serves the operator on real ones: a real 554 MB SNOMED zip **uploads fine but fails during extraction**, the RxNorm ontology builds but the UI doesn't reflect it, destructive actions delete without confirmation, code-system deletes surface an opaque `409`, the upload control is a raw browser file input with no progress on a multi-minute 500 MB+ upload, and one import fires three redundant notifications. This slice closes the acceptance gap so the feature is demo- and production-ready.

## 2. Goals / Non-goals

**Goals**
- **A** (bug): real SNOMED/large zips extract and ingest successfully.
- **B** (bug): the ontology menu enables as soon as an import completes, no manual reload.
- **C** (UX/safety): every destructive terminology action confirms, sits in a red danger zone, and the code-system-delete block states its reason.
- **D** (UX): a modern dropzone with a live upload progress bar for large files.
- **E** (UX): one start toast + one completion toast + the durable bell; no inline banner triplication.
- Each fix verified in the live containerized stack against the real inputs (the failing 554 MB SNOMED blob is retained in MinIO).

**Non-goals**
- Changing the ingest/orchestration internals (Slices 1–3) beyond the extraction step.
- Resumable/chunked uploads or client-side zip validation.
- A general notifications-system redesign (the bell stays as built in [[notification-bell-workstream]]).
- Reworking the terminology page IA beyond the menu danger-zone reordering.

## 3. Evidence (from the live stack)

- **A** — `terminology_ingest_jobs`: snomed `failed`, error `unexpected end of file`; api log: `{err:{message:"unexpected end of file", code:"Z_BUF_ERROR", errno:-5, stack:"...Zlib.zlibOnError...node:zlib"}}`. MinIO: the snomed zip is fully stored (554 MiB). Container disk: 852 GB free. ⇒ not a truncated upload, not ENOSPC — a streaming-inflate failure inside `unzipper.Extract()`.
- **B** — `ontology_distributions`: `cs-url-RXNORM | rxnorm | ready | node_count 72485 | edge_count 141311`; `coding_systems` has a single `cs-url-RXNORM` row (no duplicate). ⇒ ingest correct; UI state stale.
- **C/#5** — coding-system delete route maps a `TerminologyAdminError` (kind ≠ 'not-found') to `409` via `mapErr` (`terminology-admin-routes.ts:462`); the client shows "delete system failed: 409".
- **D** — the dialog renders a raw `<input type="file">`; `uploadTerminologyDistribution` (`apps/studio/src/api.ts`) uses `fetch`, which cannot report upload progress.
- **E** — the page shows an inline green "Import started…" banner in addition to a toast and the bell entry.

## 4. Design

### 4a. SNOMED extract — random-access unzip (`packages/bootstrap/src/terminology-dist-extract.ts`)
`downloadAndExtract` already streams the blob to `zipPath` on disk. Replace the streaming `unzipper.Extract()` step (which races/`Z_BUF_ERROR`s on data-descriptor / ZIP64 zips) with **random-access** extraction:
- `const directory = await unzipper.Open.file(zipPath)` — reads the central directory (authoritative compressed/uncompressed sizes and offsets; correctly handles data descriptors and ZIP64).
- For each `entry` in `directory.files`:
  - skip `entry.type === 'Directory'`;
  - compute `dest = join(distDir, entry.path)` and **guard against zip-slip**: reject if the resolved `dest` is not within `distDir` (`path.relative(distDir, dest)` must not start with `..` or be absolute);
  - `await mkdir(dirname(dest), { recursive: true })`;
  - `await pipeline(entry.stream(), createWriteStream(dest))`.
- Keep the existing `cleanup()` (rm the whole workDir).

This removes the duplexer2 race note entirely (no streaming parser). The zip-slip guard preserves the implicit safety `Extract()` provided. `unzipper` stays the dependency (no new dep).

### 4b. Ontology UI refresh after import (`apps/studio/src/pages/Terminology.tsx`)
The page already polls a job's status while `IMPORTING…`. On a terminal transition (`ready`/`failed`), in addition to clearing the badge, **refetch** the ontology-distributions map (the `distributions` state that gates "Browse ontology" via `distributions[id]?.indexStatus === 'ready'`) and the coding-systems list. So "Browse ontology" enables the moment the ontology finishes, without a manual reload. (No server change — the data is already correct; only the client refetch is missing.)

### 4c. Destructive-action confirm + danger zone (`apps/studio/src/pages/Terminology.tsx` + server message)
Client:
- Introduce a reusable confirm step (shadcn `AlertDialog`) for the three destructive actions: **Delete stored distribution**, **Delete code system**, **Delete publisher**. Each dialog states exactly what is removed and what survives, e.g.:
  - stored distribution → "Delete the retained **{system}** distribution zip? Already-ingested terms and ontology are **not** affected."
  - code system → "Delete coding system **{code}**? This removes the system and its terms." (only reachable when the server allows it)
  - publisher → "Delete publisher **{name}**? Its coding systems must be removed first." (mirror server rules)
- Move each destructive item to the **bottom** of its menu, in its own section after a `DropdownMenuSeparator`, styled `text-destructive` (the code-system Delete already is; extend the pattern consistently).

Server (`apps/server/src/terminology-admin-routes.ts` + `@openldr/db` admin store):
- The code-system delete guard currently throws a generic `TerminologyAdminError` → `409`. Enrich the thrown message with the **reason and remedy**: when blocked because the system has concepts and/or a linked ontology, the message reads e.g. *"Cannot delete coding system LOINC: it has 6 concepts and a linked ontology distribution. Delete the stored distribution first."* The client surfaces the server message verbatim (it already renders `error` from the response) instead of the bare `409`. (Count/ontology-presence come from the store method that raises the guard.)

### 4d. Upload dropzone + live progress (`apps/studio` upload dialog + `apps/studio/src/api.ts`)
- **Dropzone component:** drag-and-drop + click-to-browse, a plus/upload icon, copy "Drag a distribution .zip here or click to browse", accepts `.zip`, shows the selected **filename + human size**, and a clear/replace affordance. Replaces the raw `<input type="file">`. Reuse existing shadcn primitives; keep it a focused component.
- **Live upload progress:** `uploadTerminologyDistribution` switches from `fetch` to **`XMLHttpRequest`** so `xhr.upload.onprogress` yields `loaded/total`. Signature gains an `onUploadProgress?: (pct: number) => void`. The dialog renders a progress bar (0–100%) during the upload phase; on `201` + `{jobId}` it hands off to the existing job-status/bell for the ingest phase. Auth: reuse the same bearer the current `authFetch` sends (read the token the app already holds and set the `Authorization` header on the XHR). Content-type stays `application/octet-stream` (the raw-body passthrough parser is unchanged).

### 4e. Notification consolidation (`apps/studio/src/pages/Terminology.tsx`)
- Remove the inline green "Import started — you'll be notified…" banner.
- Fire exactly **one** toast on start ("Import started — you'll be notified when it completes").
- Completion/failure is signalled by the existing notification poller's toast **and** the durable bell entry; ensure the page does not additionally toast on completion (no double-signal).
- Keep the in-row `IMPORTING…` badge as the in-place status.

## 5. Testing

- **A (unit):** a `downloadAndExtract` test that extracts a zip containing a **nested directory** and (if feasible to construct) a **data-descriptor** entry, asserting all files land at the right paths; a zip-slip entry (`../evil`) is rejected. Reuse/extend `terminology-dist-extract.test.ts`.
- **A (live):** re-run the ingest against the retained 554 MB SNOMED blob in the running stack → job `ready`, concepts + ontology populated. This is the acceptance gate for A.
- **B:** component/behaviour test that a terminal job transition triggers a distributions refetch; live check that "Browse ontology" enables post-import without reload.
- **C:** client tests that each destructive action opens a confirm dialog and only calls the API on confirm, and that the destructive items render in the danger section; server test that a blocked code-system delete returns the enriched reason message (not a bare 409); live check of the LOINC delete message.
- **D:** client test that `uploadTerminologyDistribution` reports progress (mock XHR `upload.onprogress`) and resolves on load; dropzone accepts drag + click and shows filename/size.
- **E:** test that starting an import fires one toast and renders no inline banner; no completion toast is fired by the page itself.
- Gate: `pnpm turbo run typecheck test --force` (touched packages verified in isolation per [[repo-conventions]]).

## 6. Out of scope (future)
- Resumable/chunked or background-resumable uploads.
- Client-side pre-validation of distribution structure before upload.
- Publisher-scoping nuance: the seeded SNOMED coding system is owned by `pub-hl7-fhir` while the upload entry point is under `pub-snomed-ct` (resolve-by-URL links them correctly; cosmetic only).

## 7. Open questions / risks
- **`unzipper.Open.file` memory/perf on 554 MB:** it opens the file for random access and streams entries — it does **not** buffer the whole archive; per-entry streaming keeps memory bounded. Validated by the live SNOMED re-run.
- **XHR auth token access:** the dialog must read the same bearer `authFetch` uses. If the token isn't exposed outside `authFetch`, add a small accessor rather than duplicating refresh logic.
- **Enriched delete message source:** the concept count / ontology-presence must come from the store guard that already blocks the delete; if it currently throws without those details, the guard is extended to include them (small, server-side).
