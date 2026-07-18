# Load & push data

Once OpenLDR is running, you need to get lab data into it. There are three ways, depending
on what you have. **There is no generic "POST your FHIR here" URL** — data enters through one
of the paths below.

## 1. Load a file with the CLI (the simplest path)

The `openldr ingest` command reads a file, converts it, and writes the results into the FHIR
store. The **converter** decides how the file is parsed.

Run it inside the installed directory (or from a source checkout with `pnpm openldr …`):

```bash
# A FHIR transaction Bundle (the default converter)
openldr ingest bundle.json

# A WHONET SQLite export, via a converter plugin (install the plugin first)
openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
openldr ingest whonet.sqlite --plugin whonet-sqlite

# A CSV/TSV with a column mapping
openldr ingest results.csv --plugin tabular --config mapping.json
```

A successful run prints `batch <id>: done (<n> resources)`. If it says **0 resources**, the
converter did not recognise the file — check the file against the converter you chose (a bare
JSON array is *not* a FHIR Bundle, for example). Inspect or retry a batch with
`openldr pipeline status` and `openldr pipeline retry <batchId>`.

Converters that ship with OpenLDR: `fhir-bundle` (default), `whonet-sqlite`, `hl7v2`, and
`tabular`. More can be added as marketplace plugins.

## 2. Push over HTTP with a workflow webhook

To have an external system push continuously, build a **workflow** with a **Webhook trigger**:

1. In the app, open **Workflows** and create a workflow.
2. Add a **Webhook** trigger. It gives you a URL path and a secret.
3. Add nodes that validate/transform the incoming JSON and a **Persist / Store** node that
   writes it.
4. Save and enable the workflow.
5. Have the external system `POST` its payload to
   `https://your-host/api/workflows/hooks/<path>` with the webhook secret.

The request body is handed to the workflow as its input — **what gets stored is whatever the
workflow does with it**, so you control the exact shape. This is deliberately flexible: the
same mechanism accepts a form submission, a vendor JSON payload, or a Bundle you normalise
inside the workflow.

## 3. Lab-to-central sync (not for third parties)

If this instance is a **lab** enrolled with a **central** OpenLDR server, its data replicates
up automatically over the sync channel (`POST /api/sync/push`, machine-authenticated). This is
lab↔central replication only — a third-party system cannot push to it. See the in-app
**Distributed Sync** guide.

## Where the data goes

Ingested resources land in the internal FHIR store and are projected into the analytics
warehouse that reports and dashboards read. If data ingests but does not show up in a report,
confirm the target store is configured (see [Environment variables](/docs/environment)) and
give the projection a moment to catch up.
