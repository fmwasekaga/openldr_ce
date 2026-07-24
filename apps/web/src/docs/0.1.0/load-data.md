# Load & push data

Once OpenLDR is running, you need to get lab data into it. OpenLDR has **no generic FHIR
ingest endpoint** — there is no `POST /fhir` you can send resources to. Data comes in through
one of the paths below. Which one you use depends mostly on how you installed.

> **Where's the `openldr` CLI?** The `openldr` command is part of the **source checkout** — you
> run it as `pnpm openldr …` from a clone of the repository. The **one-line Docker installer
> does not install a CLI**, and it doesn't need to: it sets `MIGRATE_ON_START=true` and
> `SEED_ON_START=true`, so the stack migrates and seeds itself on first boot. On a Docker
> deployment, use the **HTTP webhook** below. The CLI paths apply when you run OpenLDR from
> source (or run a source checkout whose `.env` points at your deployment's databases).

## 1. Push over HTTP with a workflow webhook (works on any install)

The inbound HTTP path is a **workflow** with a **Webhook** trigger. The request body is handed
to the workflow as its input, and **what gets stored is whatever the workflow does with it** —
so you control the exact shape (a form submission, a vendor payload, or a FHIR Bundle you
normalise inside the workflow).

A fresh install ships **two** ingestion webhook workflows, split by the **shape** of the data the
sender posts. **Both are disabled by default** — each exposes a live HTTP endpoint, so you opt in
by enabling the one you need and copying its per-install secret:

| Workflow | Webhook path | Expects | Use when |
|---|---|---|---|
| **Ingest-form** | `lab-orders` | **form answers** (a `{…}` object of field values) | a form/UI-driven source posts answers, not FHIR — validated against the seeded "Lab order" form, then persisted |
| **Ingest-raw** | `cdr-ingest` | a **bare JSON array** of pre-built FHIR resources | an external system posts ready-made FHIR (e.g. the **CDR toolchain**) — each resource is persisted and the projection routes it by type |

To use either one:

1. In the app, open **Workflows** and open **Ingest-form** or **Ingest-raw**.
2. On its **Webhook** trigger, **enable** the workflow and **copy the secret**. Each trigger has a
   fixed URL path (above) and a per-install secret generated at seed time.
3. Send the payload from your external system:

```bash
curl -X POST https://your-host/api/workflows/hooks/lab-orders \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <the-webhook-secret>" \
  -d @order.json
```

**Security:** the secret is sent in the `X-Webhook-Token` header and checked in constant time on
the server. Always POST over **HTTPS** so the token isn't exposed, treat the secret like a
password, and rotate it by editing the workflow's webhook trigger. A wrong or missing token is
rejected with `401`; an unknown path returns `404`.

You can also build your own webhook workflow (**Webhook → transform/validate → Persist / Store**)
for any other payload shape — the two seeded ones are just the common cases.

### Post pre-built FHIR (the CDR toolchain)

The **Ingest-raw** workflow is the front door for a system that already emits FHIR resources — most
notably the **CDR toolchain**, whose default target path (`OPENLDR_CE_HOOK_PATH`) is exactly
`/api/workflows/hooks/cdr-ingest`, so it lines up with a fresh install out of the box. The pipeline
is **Webhook → Split Out (`body`) → Persist / Store → Log**:

- The request body is a **bare JSON array** of FHIR resources. **Split Out** unwraps the webhook
  envelope's `body` array into **one item per resource**, because **Persist / Store persists one
  FHIR resource per input item** — the same write path (and **validation strictness gate**) the CLI
  uses.
- **One webhook handles tests and questionnaires together.** Persist stores every resource, and the
  projection routes each by `resourceType` (`Observation` → `lab_results`, `ServiceRequest` →
  `lab_requests`, `QuestionnaireResponse` → `questionnaire_responses`, …).

To point the CDR toolchain at a deployment, enable **Ingest-raw**, copy its secret, and set:

```bash
OPENLDR_CE_URL=https://your-host        # base URL of the CE deployment
OPENLDR_CE_WEBHOOK_TOKEN=<the-secret>   # the Ingest-raw webhook secret you copied
OPENLDR_CE_TIMEZONE=+03:00              # UTC offset for DISA's unzoned timestamps (per country)
```

`OPENLDR_CE_TIMEZONE` is **required** and has no safe default: DISA stores local wall-clock times
with no zone, so an omitted offset would silently shift every clinical timestamp. Set it to the
deployment's country (Tanzania `+03:00`; Mozambique/Zambia `+02:00`).

> **A bare array is what the webhook wants — but not what the CLI wants.** The `cdr-ingest` webhook
> expects a bare array of resources (Split Out expands it). The `openldr ingest` **CLI** below is the
> opposite: it takes a FHIR **Bundle** (or one bare resource), not an array. Send each payload to the
> path that matches its shape.

If you just have a Bundle file and a source checkout, `openldr ingest bundle.json` (below) is the
turnkey path — it applies the same converter + strictness gate without building a workflow.

## 2. Load a file with the CLI (source / developer installs)

If you run OpenLDR from a source checkout, `pnpm openldr ingest <file>` reads a file, converts
it, and writes the results into the FHIR store. The **converter** decides how the file is
parsed:

```bash
# A FHIR Bundle (the default converter)
pnpm openldr ingest bundle.json

# A WHONET SQLite export, via a converter plugin (install the plugin first)
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest whonet.sqlite --plugin whonet-sqlite

# A CSV with a column mapping
pnpm openldr ingest results.csv --plugin tabular --config mapping.json
```

A successful run prints `batch <id>: done (<n> resources)`. **0 resources** means the converter
did not recognise the file. Inspect or retry a batch with `pnpm openldr pipeline status` and
`pnpm openldr pipeline retry <batchId>`. Converters that ship with OpenLDR: `fhir-bundle`
(default), `whonet-sqlite`, `hl7v2`, and `tabular`; more can be added as marketplace plugins.

### Example payloads

**`bundle.json`** — the default `fhir-bundle` converter takes a FHIR `Bundle` (it reads each
`entry.resource`) or a single bare resource. A **clinically complete lab submission** — a patient,
the **order** (`ServiceRequest`), and the **result** (`Observation`) linked back to that order:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "p1",
        "identifier": [{ "system": "urn:lab:mrn", "value": "MRN-001" }],
        "gender": "female",
        "birthDate": "1990-05-01"
      }
    },
    {
      "resource": {
        "resourceType": "ServiceRequest",
        "id": "sr1",
        "status": "active",
        "intent": "order",
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] }
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "id": "o1",
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "basedOn": [{ "reference": "ServiceRequest/sr1" }],
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] },
        "valueQuantity": { "value": 13.5, "unit": "g/dL" }
      }
    }
  ]
}
```

> A **bare JSON array** of resources is *not* a Bundle and will not persist — wrap resources in
> a `Bundle` as above, or post a single resource object.

> **Validation strictness.** Front-door pushes are validated at the configured level (**default
> High**, in **Settings → Danger Zone → Data validation**, or `openldr settings validation`). At
> High, a **laboratory result** (an `Observation` with `category` code `laboratory`, or a `LAB`
> `DiagnosticReport`) **must reference its order** via `basedOn` — the `ServiceRequest` must be in
> the same batch or already stored — or the **whole submission is rejected** with a `422` and an
> `OperationOutcome` listing what's missing. That's why the example above includes the
> `ServiceRequest` and links the `Observation` to it. Lower the level to `medium` (order present but
> not resolved) or `low` (structure only) if you must, but High is the safe default for lab data.

**`results.csv` + `mapping.json`** — the `tabular` plugin turns rows into FHIR. Its `--config`
is a JSON file with an `output` (`fhir` or `rows`) and a `mapping` that tells the plugin which
columns become which FHIR fields:

```
mrn,sex,dob,test,value,unit
MRN-001,female,1990-05-01,Hemoglobin,13.5,g/dL
```

The exact `mapping` keys are defined by the tabular plugin and are also editable from its node
in **Workflows** (the same plugin backs the workflow **Tabular** node), so you can build and
preview a mapping in the app before saving it as `mapping.json`.

## 3. Distributed sync (lab ↔ central, not for third parties)

If this instance is a **lab** enrolled with a **central** OpenLDR server, its data replicates up
automatically over the sync channel (`POST /api/sync/push`, authenticated by the lab's
machine credentials). This is lab↔central replication only — a third-party system cannot push to
it. See the in-app **Distributed Sync** guide.

## Where the data goes

Ingested resources land in the internal FHIR store and are projected into the analytics
warehouse that reports and dashboards read. If data ingests but does not show up in a report,
confirm the target store is configured (see [Environment variables](/docs/environment)) and give
the projection a moment to catch up.
