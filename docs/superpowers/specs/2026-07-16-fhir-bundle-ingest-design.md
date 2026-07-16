# FHIR Bundle ingest — `POST /api/fhir/` — Design

**Date:** 2026-07-16
**Status:** Design agreed in brainstorm. NOT implemented.
**Repos:** `openldr_ce` (the endpoint) + `cdr-toolchain` (migrate the client off the bare array)
**Supersedes:** the "bare array wire contract" in `2026-07-16-cdr-fhir-ingest-to-ce-design.md:142-150`

---

## 0. Why

**User, 2026-07-16 (verbatim):**

> *"whole point of fhir bundle resource type is for this functionality right, if we are going to say
> we use fhir standard but then use an array instead of a Bundle, then we are making up a standard
> or lying to users."*

They are right, and it is worse than non-standard — **it is a regression, and CE actively punishes
standards-compliance.**

### 0.1 The array was never a decision

`2026-07-16-cdr-fhir-ingest-to-ce-design.md:142-150` records it as a **"verified chain"** —
reverse-engineered from what the workflow primitives happen to do (`splitOutHandler` reads
`item.json[field]`, a flat key lookup on an **array** field —
`workflows/src/engine/node-handlers/split-out.ts:8-12`), then written down as a "contract".
**Plumbing that leaked into the public interface.** No rationale exists because none was formed.

### 0.2 CE regressed from its own v1

corlix (an LIS, a real client) pushes a **transaction Bundle** to **OpenLDR v1**'s
`api/v1/processor/process-feed` as `application/fhir+json`, consumed by v1's bundled
`hl7-fhir-schema` plugin. **v1 accepts a Bundle. CE — v1's successor — accepts a bare array.**

corlix's `POST /fhir` (`corlix apps/api/src/fhir/transaction.ts:17-21`) **requires**
`resourceType==='Bundle' && type==='transaction'`, else a `badRequest` **OperationOutcome**; replies
with a `transaction-response` (`:53`); is **explicitly not atomic** (`:8-9`). Its FHIR surface has
**no array anywhere**.

### 0.3 CE is incoherent — four envelopes for one job

| path | envelope | status |
|---|---|---|
| `forms extract --json` (`cli/src/forms.ts:24`) | **transaction Bundle** | live; **nothing consumes it** |
| `openldr ingest --converter fhir-bundle` (`cli/src/index.ts:357`) | **Bundle (any type)** or one bare resource (`ingest/src/converters/fhir-bundle.ts:11-16`) | live, **genuinely tested** (`converters.test.ts:10-26`) |
| `questionnaire-response` converter | `{questionnaire, response}` | not FHIR |
| **workflow webhook** (CDR uses this) | **bare array** | **the outlier** |

**CE's own source already agrees with the user** — `forms/src/to-transaction-bundle.ts:3-7`:
*"a single FHIR `transaction` Bundle (PRD §3.2) — **Bundle's real job, at submission time**."*

### 0.4 CE punishes the correct content type — verified

`'application/fhir+json'.includes('application/json')` is **`false`** (run it). So
`workflows-routes.ts:417`'s divert check fires: the body is drained to blob storage (`:421`),
`webhookBody = undefined` (`:423`), the workflow runs with `body: undefined` (`:426`), and the caller
gets **200 OK**.

⇒ **A client sending a proper Bundle with the proper FHIR content type is silently discarded today.
A client sending `application/json` + a bare array works.**

---

## 1. Decisions taken in brainstorm

| # | Decision |
|---|---|
| D1 | **A real FHIR endpoint, Bundle-only** — like corlix. |
| D2 | **Enforce a CE ingest profile and reject loudly.** Not "accept any valid FHIR". |
| D3 | **Mount `/api/fhir/`**; auth = **machine bearer with a `site_id` claim**. |
| D4 | **Migrate `cdr-toolchain` now**; the array is never a FHIR contract again. **And fix the content-type trap in this slice.** |
| D5 | **ATOMIC — all-or-nothing.** *"make it atomic, dont accept transaction if we cant honour it"*. **Reverses** this spec's first draft (which copied corlix's `transaction`-label-with-`batch`-semantics). See §4.1. |

---

## 2. ⚠ THE CENTRAL FINDING — a conformant envelope does NOT give semantic interop

**I claimed "corlix could point at CE with near-zero change." It is FALSE.** Falsified by
field-diffing both sides. This is the single most important input to the design.

corlix's Bundle **validates against CE and every row inserts** — and fills roughly **half** of CE's
read model, **silently**:

| CE column | CE reads | corlix emits | result |
|---|---|---|---|
| `lab_results.result_timestamp` | `effectiveDateTime` (`relational/observation.ts:28`) | **`issued`** (`corlix fhir-builder.ts:322,369`) | **NULL on EVERY row** |
| `lab_results.abnormal_flag` | `interpretation[0]` (`observation.ts:10,27`) | **never sets `interpretation`**; S/I/R → `valueCodeableConcept` | **NULL on EVERY row**; S/I/R lands in `coded_value` — wrong column |
| `facilities` (whole table) | `Organization`/`Location` (`relational/index.ts:29-30`) | **emits neither** (grep count = **0**) | **permanently EMPTY** |
| `patients.patient_guid` | `identifier[0].value` | MRN deliberately first (`corlix fhir-builder.ts:130`) | **WRONG DATA — a hospital number** |

**Both sides are valid FHIR.** corlix sets `issued`; CE reads `effectiveDateTime`. Both legal.
Neither wrong. **Nothing fails.** You get a fully populated database whose timestamps, flags and
facilities are quietly empty.

corlix's own comment gives it away: `SIR_SYSTEM` exists because *"OpenLDR's hl7-fhir-schema plugin
reads this URL … to populate susceptibility_value"* (`corlix fhir-builder.ts:11-15`). **corlix's
Bundle is shaped for v1's plugin, not for FHIR-generic consumption.**

⇒ **This is why D2 exists.** CE's zod is `.passthrough()` with nearly everything optional
([[cdr-ce-fhir-ingest]]), so **CE currently cannot tell a good client from a bad one**. Shipping
"accept any valid Bundle" would build **a standards-compliant way to silently lose data** — the same
failure class as this session's NBG counts and dropped antibiotics.

⇒ **Corlix compatibility is explicitly OUT of scope** (§7).

---

## 3. Verified constraints

Everything cited here was read at the line. **Unread items are marked SKETCH.**

**Routing — `/api/fhir/` is reachable for free; `/fhir` is not.**
`deploy/nginx/openldr.conf.template:47` — `location / { proxy_pass $upstream_web$request_uri; }` ⇒
**`/fhir` goes to the LANDING container and never reaches Fastify.** `:53` —
`location /api { proxy_pass $upstream_api$request_uri; }` ⇒ `/api/fhir/` needs **no nginx change**.
*This is why D3 chose `/api/fhir/`.*

**Auth — the hook only covers `/api`, and the bypass precedent is exact.**
`auth-plugin.ts:78` — `if (path !== '/api' && !path.startsWith('/api/')) return;`
Bypasses, both with a **documented trailing-slash rationale**:
- `:73` — `if (path.startsWith('/api/workflows/hooks/')) return;`
- `:77` — `if (path.startsWith('/api/sync/')) return;` — *"a machine client has no local user record,
  so `users.syncFromClaims` must not run for it"*

⇒ add `if (path.startsWith('/api/fhir/')) return;`. **The trailing slash is mandatory** — `/api/fhir`
without it over-matches.

**The machine principal already exists** — `sync-routes.ts:8-37` `sitePrincipal`: Bearer →
`ctx.auth.verifyToken` → require a **`site_id` claim**, `403` if absent (`:31-35`). This is exactly a
foreign CDR's shape and is the model for D3.
⚠ Its comment names a trap: it uses **`await reply…send()`, not `return`**, because the helper
signals "already answered" by resolving `undefined` — returning the reply would make it truthy and
defeat every `if (!principal)` guard.

**Atomicity IS achievable — and the load-bearing invariant STRENGTHENS. (D5, verified.)**
- `FhirStore.save(resource, provenance?)` (`fhir-store.ts:114`) takes no transaction **in its
  signature** — but its body **already opens one**: `db.transaction().execute(...)`
  (`fhir-store.ts:214`), spanning `fhir_resources` + `resource_history` + `change_log` for **one**
  resource. **Atomicity across N is hoisting that transaction, not inventing one.**
- ⚠ **THE INVARIANT** (`fhir-store.ts:~260`, verbatim): *"the change_log insert must NOT be this
  transaction's first write. The fhir_resources upsert + resource_history insert above run first, so
  the txn's xid is assigned before `nextval(seq)` is drawn here. The R2 projection worker relies on
  this: a gap's txn xid < the snapshot's xmax that stamps its x0. Inserting into change_log as a
  transaction's first statement would reopen a permanent-skip window."*
  **With one txn spanning N resources it HOLDS AND STRENGTHENS**: resource 1's history/
  `fhir_resources` insert assigns the xid before *any* `change_log` `nextval` is drawn.
  ⚠ **It is stated at THREE sites** — `save()` (`:214+`), `applyRemote()` (`:311`), and
  `writeVersion()` (`:164-176`, *"Do NOT reorder these inserts. (Mirrors save()/applyRemote().)"*).
  **A 4th writer must carry it too, or the ordering must be factored into one helper.**
- **The projection copes**: `fetchSafeChangeRows` (`projection/fetch.ts:18-19`) reads under
  `repeatable read` with an `xmin`/`xmax` snapshot. N rows sharing **one** xid become visible
  **together** ⇒ the projection can never observe a **partial** Bundle. Strictly better than today.
- **Concurrency is already correct for this**: the `resource_history` PK `(resource_type,id,version)`
  serializes concurrent same-key writes; a race loser hits duplicate-key and **rolls back
  atomically** (`fhir-store.ts:215-221`). Under `saveMany` a race loser rolls back **the whole
  Bundle** — which is exactly what atomic means.
- `persistResources` (`persist.ts:31-44`) **throws mid-loop** on the first invalid resource (`:39`),
  leaving resources before it **already saved** — **partial write, no rollback.**
  ⇒ **the route must NOT call it as-is.** Under D5 it is replaced by **validate-all-then-write-all**
  (§4.1), which removes the partial-write hazard rather than reporting around it.

**Projection remains async — and this still bounds what the response may claim.**
`persist.ts:41` only ever returns `{ saved: true, flattened: 'deferred' }` (`persist.ts:17-19`).
⇒ even when atomic, the response may honestly say **"stored"**, **NEVER** "landed in `lab_results`".
Atomicity is over the **FHIR write**, not the projection.
⚠ **`'written' | 'skipped' | 'degraded'` (`persist.ts:8`) are DEAD** — never produced. So
`persist-store-service.ts`'s `flattened[r.flattened] += 1` tally always yields
`{written:0, skipped:0, degraded:0, deferred:N}`. **Decoration.** Do not build on it.

**OperationOutcome already exists** — `packages/fhir/src/operation-outcome.ts`: `outcomeFromIssues`
(`:17`), `singleIssueOutcome` (`:21`), **`issuesFromZodError` (`:30`)** which maps zod →
FHIR issue codes. Tested; already used by `terminology-routes.ts`.
**But** `error-handler.ts:82` emits `void reply.code(status).send({ error, code, correlationId })`
**unconditionally, for every route**, with **no content negotiation**. ⇒ wiring FHIR paths to
`OperationOutcome` is **new work**.

**The reply.send invariant — and why unit tests can't see it.**
Rule `apps/server/eslint-rules/require-return-reply-send.mjs`, wired at `eslint.config.mjs:22`.
`@fastify/compress` is global; a bare `reply.send()` in an **async** handler returns an **empty
body >1KB**. A transaction-response Bundle is comfortably >1KB ⇒ **every send must
`return`/`await`**. ⚠ **`app.inject` CANNOT see this bug**; the real-HTTP harness is
`package.json:49` — `"sync:gzip:accept": "tsx scripts/sync-gzip-live-acceptance.ts"`.

---

## 4. Design

### 4.1 The contract

| | |
|---|---|
| **Route** | `POST /api/fhir/` |
| **Accepts** | a **`transaction` Bundle** only, `Content-Type: application/fhir+json` |
| **Returns** | a **`transaction-response` Bundle** |
| **Rejects** | bare array, non-Bundle, `Bundle.type !== 'transaction'` ⇒ `400` + **`OperationOutcome`** |
| **Auth** | machine bearer + **`site_id` claim**, per `sitePrincipal` |
| **Atomicity** | ✅ **ATOMIC — all-or-nothing (D5).** One DB transaction spans every entry. |

**One contract, no aliases.** `transaction` only — because `collection` carries no per-entry
`request`, and accepting several types recreates the ambiguity we are removing.

### D5 — atomic, because we will not claim a standard we do not honour

**User, 2026-07-16 (verbatim):** *"make it atomic, dont accept transaction if we cant honour it"*

This **reverses** the earlier draft of this spec, which proposed accepting `Bundle.type:
'transaction'` with `batch` semantics underneath — *"like corlix"*. corlix has exactly that mismatch
and documents it (`corlix transaction.ts:8-9`). **Documenting a lie does not stop it being one**, and
it is the same defect the user objected to at the top of this spec: claiming FHIR while doing
something else. **Precedent is not a justification.** We diverge from corlix here, deliberately.

FHIR's `transaction` means all-or-nothing. So ours is.

### 4.1.1 Validate-all-then-write-all

Atomicity **simplifies** the route rather than complicating it:

1. **Parse + profile-validate EVERY entry. No writes.**
2. **Any entry fails** ⇒ `400` + a `transaction-response` whose entries carry per-entry
   `OperationOutcome`s naming every defect. **NOTHING is written.**
3. **All pass** ⇒ **one** `FhirStore` transaction writes all N ⇒ `200` + `transaction-response`,
   `201` per entry.

This **deletes** the earlier draft's per-entry `try`/`catch`-around-writes, and with it the
partial-write hazard of `persistResources` (`persist.ts:39`). A failure mode removed beats a failure
mode reported.

⚠ **The write still needs `saveMany`** — see §4.1.2. `persistResources` must NOT be used as-is.

### 4.1.2 `FhirStore.saveMany` — the mechanism

> **SKETCH — the shape is not settled; verify against the real file before coding.**

`save()` already wraps ONE resource in `db.transaction().execute(...)` (`fhir-store.ts:214`).
`saveMany(resources, provenance): Promise<SavedRef[]>` hoists that to span N, preserving per-resource
ordering (`resource_history` + `fhir_resources` **before** that resource's `change_log`).

**Why the invariant survives** — see §3: resource 1's first write assigns the txn's xid before any
`change_log` `nextval` is drawn, so it holds **more** strongly than in the per-resource case.

Also hoist out of the loop: `resolveSiteId()` (once, before the txn) and the `pg_notify` wakeup
(once, **after** the txn — it is best-effort and must never affect the write, `fhir-store.ts:271-273`).

⚠ **Two options, DECIDE IN PLANNING:**
- **(a) add `saveMany`** — additive, no existing caller changes. But the ordering invariant then
  lives at a **4th** site (§3 lists three).
- **(b) factor the ordering into one helper** that `save`/`applyRemote`/`writeVersion`/`saveMany`
  share — removes the duplication that makes the invariant fragile, but **touches the sync write
  path**, which is live and load-bearing ([[distributed-sync-central-workstream]]).
**Recommendation: (a).** This slice should not refactor the sync write path. Log (b) as debt.

⚠ **Rule 8:** `FhirStore` is a **shared interface**. Adding `saveMany` obliges a typecheck of
**every** consuming package (`turbo typecheck`), not just `@openldr/db` — vitest strips types and
will stay green over a type error.

⚠ **pg-mem**: tests run against pg-mem in places (`fhir-store.ts:222` notes bigint reads back
differently). **SKETCH — verify pg-mem supports the hoisted transaction** before assuming the test
suite proves atomicity.

### 4.2 Profile enforcement — the substance of the slice

Each entry is validated against **CE's documented ingest expectations**, not merely R4. A client that
would produce a NULL `result_timestamp` gets a per-entry `OperationOutcome` naming the exact path.
`issuesFromZodError` (`operation-outcome.ts:30`) supplies the vocabulary.

The profile is **derived from the projection** — the fields `relational/*.ts` actually read:

| resource | field | why | source |
|---|---|---|---|
| `Observation` | `effectiveDateTime` | `lab_results.result_timestamp` | `observation.ts:28` |
| `Observation` | `basedOn[0]` | `lab_results.request_id` | `observation.ts:16` |
| `Observation` | `subject` | `lab_results.patient_id` | `observation.ts:17` |
| `Observation` | `specimen` | `lab_results.specimen_id` | `observation.ts:18` |
| `Observation` | `interpretation[0]` **when S/I/R** | `lab_results.abnormal_flag` — the AMR path | `observation.ts:10,27` |
| `ServiceRequest` | `identifier[0].value` | `lab_requests.request_id` | `service-request.ts:11` (`request_id: idn.value`) |
| `ServiceRequest` | `authoredOn` | `lab_requests.authored_at` | `service-request.ts:18` |

> **SKETCH — the profile's exact required/optional split is NOT decided.** It is a
> **clinical/product** judgement, not a mechanical one. Deriving *candidates* from the projection is
> mechanical; deciding **which are hard-required vs warned** is not. **Do not let an implementer
> infer it.** Open: is a missing `interpretation` an *error* on any Observation, or only on one whose
> value is S/I/R? Is `authoredOn` required or warned? **Resolve with the user before coding.**

⚠ **Required-field enforcement must not be a fourth vocabulary.** Prefer expressing the profile
where terminology/validation already lives rather than a hand-rolled `if` ladder — the same
anti-hardcoding argument as [[amr-terminology-slice-c]]. **SKETCH — investigate:** can
`packages/fhir`'s zod schemas carry a stricter "ingest profile" variant, or is a separate validator
needed? I have **not** read `packages/fhir/src/validate.ts`.

### 4.3 The content-type fix (D4) — cheaper than it looks

**The problem:** `terminology-admin-routes.ts:35-37` registers `application/fhir+json` as a
**passthrough** (`done(null, payload)` — the **raw stream, unparsed**), for ValueSet **file** uploads
(`studio/src/api.ts:802`). It is registered on the **root** app (`app.ts:117`), so it leaks app-wide.
⇒ `req.body` on a new `/api/fhir/` route would be a **stream, not an object**.

**The fix:** replace it with a **real JSON parser**.

**Why it's safe** — `parseJsonUpload` (`terminology-admin-routes.ts:403-408`) **already tolerates a
parsed object**:
```ts
if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !isReadableBody(body)) return body;   // :404
```
⇒ ValueSet import takes the `:404` branch instead of the buffer branch and **keeps working**.
Gzipped uploads are unaffected: studio sends **`application/gzip`** for `.gz` (`studio/api.ts:802`),
which keeps its own passthrough, and the gunzip branch (`:406`) still serves it.

⚠ **Known loss:** gzipped bytes sent *as* `application/fhir+json` would now fail at parse. Studio
never does this. **Accepted.**

⚠ **Also fix `workflows-routes.ts:417`.** Even though the webhook is no longer a FHIR contract, its
`!ct.includes('application/json')` substring check silently blob-storages any `+json` suffix type.
**Leaving a known silent-drop in place because "we don't use that path" is how this slice's bug was
born.** *(SKETCH — decide: fix the check, or narrow the divert to explicitly-binary types.)*

### 4.4 Migration (D4)

- **`cdr-toolchain` switches to `POST /api/fhir/`** with a transaction Bundle + `application/fhir+json`.
  ⚠ **Timing is on our side: its CE work is on local `main` and UNPUSHED (`f36c692`,
  [[cdr-ce-fhir-ingest]]) — nobody depends on it. This is the cheapest it will ever be.**
- **The workflow webhook STAYS** — it is a *general* trigger, not FHIR-specific. It is simply no
  longer documented or used as a FHIR ingest.
- **Correct `2026-07-16-cdr-fhir-ingest-to-ce-design.md:142-150`** so no one treats the bare array as
  a designed interface.

⚠ **Rule 6 — the correction must propagate.** That spec's §"wire contract" is cited by its own plan
and by [[cdr-ce-fhir-ingest]]. Grep both and fix every derived statement, not just the section.

---

## 5. Testing

**Rule 7 — every assertion must be able to FAIL.** Name the mutation that turns each red.

| Test | Must fail when |
|---|---|
| a bare **array** ⇒ `400` + OperationOutcome | someone "helpfully" re-adds array support |
| `Bundle.type: 'collection'` ⇒ `400` + OperationOutcome | the type check is dropped |
| a valid transaction Bundle ⇒ `200` + **`transaction-response`** with **one entry per request entry** | entries are silently dropped |
| **entry 2 invalid ⇒ entries 1 and 3 are NOT stored either** (D5 atomicity) — assert the store is **empty**, and entry 2's OperationOutcome names the defect | someone calls `persistResources` as-is (`persist.ts:39` throws mid-loop ⇒ **1 and 3 ARE stored** ⇒ red), or `saveMany` is replaced by a per-resource loop |
| **a mid-Bundle DB failure rolls back EVERY entry** (e.g. a duplicate `resource_history` PK on entry 3 — `fhir-store.ts:215-221`) ⇒ store empty | the transaction is per-resource rather than hoisted |
| **`change_log` is never the txn's FIRST write** under `saveMany` — assert `fhir_resources`/`resource_history` precede it | someone reorders the inserts ⇒ **reopens the projection permanent-skip window** (§3). ⚠ **SKETCH — how to assert this deterministically is UNRESOLVED; a naive test will be vacuous. Resolve in planning.** |
| **profile**: Observation without `effectiveDateTime` ⇒ rejected, outcome names `Observation.effectiveDateTime` | the profile regresses to bare R4 — **the corlix failure mode (§2)** |
| **profile**: S/I/R in `valueCodeableConcept` with no `interpretation` ⇒ rejected | ⚠ **this is exactly what corlix sends** — the highest-value test in the slice |
| `application/fhir+json` body arrives **parsed** (not a stream) | the passthrough parser regresses (§4.3) |
| ValueSet import **still works** after the parser change | the `:404` branch assumption is wrong |
| `POST /api/fhir/` without a `site_id` claim ⇒ `403` | the auth-plugin bypass is added without a route guard ⇒ **WIDE OPEN** |
| a **>1KB** transaction-response arrives **intact over real HTTP** | a bare `reply.send()` clobbers the body |

⚠ **The >1KB test CANNOT use `app.inject`** — the rule's own doc says the bug "stayed invisible even
to a test driving the real `buildApp`. Only a real-HTTP acceptance harness caught it." Model it on
`package.json:49` `sync:gzip:accept`.

⚠ **Vacuity guard:** a "rejected with OperationOutcome" test passes if the route rejects
*everything*. **Every rejection test must be paired with an acceptance test on the same fixture
minus the defect.**

**Live proof** — 6 real DISA labs are ingested. After migration, re-post one lab through
`POST /api/fhir/` and diff the projected rows against the current array-path rows. **They must
match.** This is the only evidence that matters.

**Gate:** `pnpm turbo run typecheck test --force`. **Rule 8** — if this widens `AppContext` or any
shared type, typecheck **every** consuming package; vitest strips types and stays green over a type
error.

---

## 6. Regression modes

- **Auth bypass added, route guard forgotten** ⇒ `/api/fhir/` is **unauthenticated and world-writable**.
  The bypass (§3) and the `sitePrincipal` guard are **one change, never two**. **Worst case in the slice.**
- Route calls `persistResources` as-is ⇒ **partial write + 500** (`persist.ts:39`) — **D5 violated
  silently**: the caller sees a failure and assumes nothing landed, while some entries did. **This is
  the atomicity claim failing exactly the way the user forbade.**
- `saveMany` written as a loop of `save()` calls ⇒ **N transactions, not one** ⇒ non-atomic while the
  route advertises `transaction`. **Looks correct, tests green if the test only checks the happy
  path** — which is why the failure-path test in §5 asserts the store is **empty**.
- `change_log` inserted before `fhir_resources`/`resource_history` in `saveMany` ⇒ **reopens the
  projection permanent-skip window** (§3). Silent, and it corrupts the read model, not the write.
- Async handler uses a bare `reply.send()` ⇒ **empty gzip body**; lint catches it, `app.inject` does not.
- Parser changed without re-testing ValueSet import ⇒ terminology import breaks (§4.3).
- Profile too strict on day one ⇒ **cdr-toolchain's own payload is rejected**. Mitigate: build the
  profile against the **6 live labs** and require the current payload to pass **before** merging.
- Profile too lax ⇒ we shipped §2's silent half-fill behind a standards-compliant façade.

---

## 7. Explicitly out of scope

- **corlix compatibility.** §2: ~a dozen field changes across both repos (`effectiveDateTime`,
  `interpretation`, `authoredOn`, `accessionIdentifier`, `Specimen.status`, the specimen-origin
  extension, `Organization`/`Location` emission, the `identifier[0]` ordering hack) **plus design**
  for the `hasMember` micro tree and facility attribution, **plus** a new client (CE has no
  `/api/v1/processor/*`). **Its own workstream. Do not let "Bundle support" imply it.**
- ~~Making the write atomic.~~ **NOW IN SCOPE — see D5 / §4.1.2.**
- **Factoring the change_log ordering invariant into one shared helper** across
  `save`/`applyRemote`/`writeVersion`/`saveMany` (§4.1.2 option (b)). Real debt — the invariant lives
  at 3 sites today and this slice adds a 4th — but it touches the **live sync write path**. Named,
  separate.
- **`GET /api/fhir/*` / search / `CapabilityStatement`.** Ingest only. ⚠ But a FHIR base URL with no
  `metadata` is itself a half-truth — **flag as the natural next slice.**
- **Per-resource endpoints** (`POST /api/fhir/Observation`) — corlix has them; CE does not need them yet.
- **`packages/ingest`'s CLI path.** `--converter fhir-bundle` already takes a Bundle and is tested;
  it is not the problem.
- **Removing the dead `'written'|'skipped'|'degraded'`** (`persist.ts:8`) and the decoration tally.
  Real debt, named, separate.

---

## 8. Known caveats

- **`packages/fhir` is `.passthrough()` with nearly everything optional** ([[cdr-ce-fhir-ingest]]) —
  `{"resourceType":"Specimen"}` validates and persists. **The profile (§4.2) is the ONLY thing
  standing between a conformant client and a quietly-empty warehouse.** If the profile is weak, this
  slice is theatre.
- **The parser leak is a latent coupling.** The `application/fhir+json` parser exists only because
  `registerTerminologyAdminRoutes` is called with the **root** app (`app.ts:117`). Nobody uses
  `fastify.register()` encapsulation. If terminology-admin is ever scoped into a plugin, `/api/fhir/`
  breaks. **SKETCH — consider registering the FHIR parser from the FHIR route module itself and
  guarding with `hasContentTypeParser` (the `workflows-routes.ts:148` idiom) — but note that idiom
  makes registration order load-bearing, which is its own hazard.**
- **`site_id` semantics are borrowed, not designed.** `sitePrincipal` scopes *distributed sync*
  writes to a site. Whether a CDR tool's `site_id` means the same thing — and what it should scope on
  ingest (provenance? rejection of foreign facility ids?) — is **UNRESOLVED**. Each country runs its
  **own** CE ([[cdr-ce-fhir-ingest]]), so cross-country tenancy is *not* the concern; intra-country
  site attribution is. **Decide in planning.**
- **`Provenance` is required on `write()`** ([[ce-projection-drops-provenance]]) — the route must
  stamp `sourceSystem`/`batchId`. `persist-store-service.ts` stamps a per-run `batchId` and emits
  `data.persisted`; `POST /api/fhir/` should do the same or explicitly say why not (Activity/payload
  lifecycle depends on `batchId` — [[payload-lifecycle-activity]]).
