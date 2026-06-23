# OpenLDR Community Edition

OpenLDR CE is an open-source laboratory data repository for antimicrobial-resistance (AMR) surveillance. It ingests laboratory results from multiple formats, stores them as FHIR R4, and produces WHO GLASS-aligned reports and DHIS2 exports.

## What you can do

- **Ingest** WHONET SQLite, HL7 v2 (ORU/ORM), and CSV/Excel files through sandboxed WASM plugins.
- **Report** on AMR resistance, antibiograms, test volume, turnaround time, and patient demographics in the dashboard or exported as CSV/PDF.
- **Submit** aggregate and tracker data to DHIS2, and export WHO GLASS RIS files.
- **Configure** an external SQL Server or PostgreSQL warehouse as the reporting target.
- **Build workflows** with manual, schedule, webhook, and ingest triggers; SQL/FHIR/HTTP sources; code; filters; dataset materialization; file export; DHIS2 push; and run history.
- **Manage forms, users, audit, and marketplace artifacts** from the web app and CLI.

## Where to start

New here? Read **Getting Started** for installation and your first ingest. Setting up an integration? See **DHIS2 Aggregate Reporting** and **External Database**.

The bundled documentation navigation is intentionally compact. The repository also includes operator-grade references for CLI, environment variables, HTTP routes, and troubleshooting under `docs/`.

![Documentation](docs.png)
