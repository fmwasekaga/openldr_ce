# Command-line interface (CLI)

OpenLDR ships an operator command-line interface (CLI), `openldr`, for database,
terminology, ingest, plugin,
reporting, user, and marketplace tasks — everything you can do from the app, plus
lower-level operations.

## Running it

From a source checkout, run it through the workspace:

```
pnpm openldr <command>
pnpm openldr --help          # list every command group
pnpm openldr db --help       # drill into a group
```

Most read commands accept `--json` for machine-readable output. In a deployed stack the
common lifecycle steps (schema migration and seeding) run automatically on startup, and
admin/danger actions are also available in the Studio UI under Settings.

## Command groups

| Group | What it does |
| --- | --- |
| `health` | Report service health (auth, storage, eventing, target store). |
| `db` | `migrate`, `reset`, `seed` the database. |
| `settings` | Feature `flags list` / `flags set`, `danger <action>`, and `sync show` / `sync set` (lab⇄central sync config). |
| `terminology` | Import and query CodeSystems, ValueSets, ConceptMaps, ontologies. |
| `fhir` | Validate FHIR R4 resources. |
| `forms` | List form definitions; extract answers from a QuestionnaireResponse. |
| `ingest` | Ingest a file through the pipeline (optionally via a plugin). |
| `pipeline` | Inspect ingest batches: `status`, `retry`, `logs`. |
| `queue` | Inspect the event queue. |
| `provenance` | Provenance audit tooling. |
| `plugin` | Manage WASM ingest plugins: `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` and `run` analytics reports; `glass-export`. |
| `audit` | Read the append-only audit log. |
| `user` | Manage local users: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`, `export`. |
| `market` | Marketplace artifacts: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Author artifacts: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Lab⇄central sync: `status`, `now`, and central-side `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | List the error-code catalog. |
| `target-store` | Test the target warehouse connection. |

## Common tasks

Bring a database up to date after pulling new migrations (non-destructive, keeps data):

```
pnpm openldr db migrate
```

Reset and seed a development database (`db reset` **drops and recreates** the schema):

```
pnpm openldr db reset
pnpm openldr db seed
```

`db seed` refuses to run when migrations are pending, naming what is outstanding — run
`db migrate` first.

Install and run an ingest plugin, then ingest a file with it:

```
pnpm openldr plugin install path/to/plugin.wasm
pnpm openldr ingest data.sqlite --plugin whonet-sqlite
```

Create a local user and assign roles:

```
pnpm openldr user create --email alice@example.org --name "Alice"
pnpm openldr user set-role <id> lab_admin
```

Toggle a feature flag:

```
pnpm openldr settings flags list
pnpm openldr settings flags set dashboard.raw_sql true
```

Run a report:

```
pnpm openldr report list
pnpm openldr report run <id>
```

Enroll a lab on the central server, then connect a lab to it:

```
# On central: mint the lab's client + secret (printed once)
pnpm openldr sync enroll lab-ndola-01 --central-url https://central.example.org

# On the lab: apply the credentials, then check status
pnpm openldr settings sync set clientId sync-lab-ndola-01
pnpm openldr settings sync set mode bidirectional
pnpm openldr settings sync set enabled true
pnpm openldr sync status
```

> Distributed sync links labs to a central server: operational data pushes up to a
> read-only mirror, reference config and terminology pull down. Enrollment mints a
> per-lab Keycloak client and needs the central realm's admin service account to hold
> `manage-clients`/`view-clients`.

> Anything under `settings danger` is destructive (reset dashboards, clear audit,
> factory reset). Those commands require `--force` and mirror the Studio danger zone.
