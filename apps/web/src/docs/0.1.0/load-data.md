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

A fresh install already ships a sample **"lab orders"** webhook workflow. To use it, or to
build your own:

1. In the app, open **Workflows** and open the sample workflow (or create a new one).
2. On its **Webhook** trigger, **enable** the workflow and **copy the secret**. The trigger has
   a URL path (the sample's is `lab-orders`) and a per-install secret.
3. (If building your own) add nodes that validate/transform the JSON and a **Persist / Store**
   node that writes the result.
4. Send the payload from your external system:

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

The request body is whatever your workflow expects — the bundled `lab-orders` sample validates
the incoming order against a Form and persists the extracted FHIR resources.

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
`entry.resource`) or a single bare resource. A minimal Bundle:

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
        "resourceType": "Observation",
        "id": "o1",
        "status": "final",
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
