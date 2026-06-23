# Captured CLI Help Output

## openldr --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr --help
Usage: openldr [options] [command]

OpenLDR CE operator CLI

Options:
  -h, --help               display help for command

Commands:
  health [options]         Probe every adapter (auth, blob, eventing,
                           target-store)
  fhir                     FHIR R4 utilities
  db                       Database migrations and seeding
  target-store             Target warehouse (Postgres/SQL Server) tools
  terminology              Terminology service (CodeSystem/ValueSet/ConceptMap)
  forms                    FHIR forms (Questionnaire) utilities
  ingest [options] <file>  Ingest a payload through the pipeline (accept +
                           drain)
  pipeline                 Inspect the ingest pipeline
  queue                    Inspect the event queue
  provenance               Provenance tooling
  plugin                   Manage WASM ingest plugins
  report                   Domain reports over the analytics DB
  audit                    Append-only audit log
  users                    Local user management
  user                     Local user management (decoupled from the IdP)
  export [options]         Export the complete dataset: canonical FHIR (NDJSON
                           + Bundle) + flat-table CSV + manifest
  dhis2                    DHIS2 aggregate reporting target
  market                   Plugin/artifact marketplace
  artifact                 Author marketplace artifacts
                           (scaffold/build/sign/publish)
  help [command]           display help for command
EXIT_CODE=0
```

## openldr health --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr health --help
Usage: openldr health [options]

Probe every adapter (auth, blob, eventing, target-store)

Options:
  --json      emit machine-readable JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr fhir --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr fhir --help
Usage: openldr fhir [options] [command]

FHIR R4 utilities

Options:
  -h, --help                 display help for command

Commands:
  validate [options] <file>  Validate a FHIR R4 resource or Bundle against the
                             CE schemas
  help [command]             display help for command
EXIT_CODE=0
```

## openldr fhir validate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr fhir validate --help
Usage: openldr fhir validate [options] <file>

Validate a FHIR R4 resource or Bundle against the CE schemas

Options:
  --json      emit OperationOutcome JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr db --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db --help
Usage: openldr db [options] [command]

Database migrations and seeding

Options:
  -h, --help         display help for command

Commands:
  migrate [options]  Run internal + external migrations to latest
  reset [options]    Drop and re-run all migrations (refuses in production
                     without --force)
  seed [options]     Insert a small sample data set
  help [command]     display help for command
EXIT_CODE=0
```

## openldr db migrate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db migrate --help
Usage: openldr db migrate [options]

Run internal + external migrations to latest

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr db reset --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db reset --help
Usage: openldr db reset [options]

Drop and re-run all migrations (refuses in production without --force)

Options:
  --json      emit JSON (default: false)
  --force     allow in production (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr db seed --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db seed --help
Usage: openldr db seed [options]

Insert a small sample data set

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr target-store --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr target-store --help
Usage: openldr target-store [options] [command]

Target warehouse (Postgres/SQL Server) tools

Options:
  -h, --help      display help for command

Commands:
  test [options]  Probe the target store connection
  help [command]  display help for command
EXIT_CODE=0
```

## openldr target-store test --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr target-store test --help
Usage: openldr target-store test [options]

Probe the target store connection

Options:
  --engine <engine>  postgres|mssql (defaults to TARGET_STORE_ADAPTER)
  --json             emit machine-readable JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr terminology --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology --help
Usage: openldr terminology [options] [command]

Terminology service (CodeSystem/ValueSet/ConceptMap)

Options:
  -h, --help                           display help for command

Commands:
  import [options] <kind> <path>       import loinc|amr|resource
  lookup [options] <system> <code>
  validate-code [options]
  expand [options] <valueSetUrl>
  translate [options] <conceptMapUrl>
  publisher                            Manage terminology publishers
  system                               Manage coding systems
  term                                 Manage terms
  valueset                             Manage value sets
  ontology                             Manage ontology indexes
  help [command]                       display help for command
EXIT_CODE=0
```

## openldr terminology import --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology import --help
Usage: openldr terminology import [options] <kind> <path>

import loinc|amr|resource

Options:
  --accept-license  accept the LOINC license (default: false)
  --json            emit JSON (default: false)
  -h, --help        display help for command
EXIT_CODE=0
```

## openldr terminology lookup --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology lookup --help
Usage: openldr terminology lookup [options] <system> <code>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology validate-code --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology validate-code --help
Usage: openldr terminology validate-code [options]

Options:
  --code <code>
  --system <system>
  --valueset <url>
  --json             emit JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr terminology expand --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology expand --help
Usage: openldr terminology expand [options] <valueSetUrl>

Options:
  --count <n>
  --offset <n>
  --json        emit JSON (default: false)
  -h, --help    display help for command
EXIT_CODE=0
```

## openldr terminology translate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology translate --help
Usage: openldr terminology translate [options] <conceptMapUrl>

Options:
  --system <system>
  --code <code>
  --json             emit JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr terminology publisher --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology publisher --help
Usage: openldr terminology publisher [options] [command]

Manage terminology publishers

Options:
  -h, --help               display help for command

Commands:
  list [options]           List all publishers
  create [options] <name>  Create a new publisher
  help [command]           display help for command
EXIT_CODE=0
```

## openldr terminology publisher list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology publisher list --help
Usage: openldr terminology publisher list [options]

List all publishers

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology publisher create --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology publisher create --help
Usage: openldr terminology publisher create [options] <name>

Create a new publisher

Options:
  --role <r>  local|external (default: "local")
  --icon <i>  icon name
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology system --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology system --help
Usage: openldr terminology system [options] [command]

Manage coding systems

Options:
  -h, --help                      display help for command

Commands:
  list [options]                  List all coding systems
  create [options] <code> <name>  Create a new coding system
  help [command]                  display help for command
EXIT_CODE=0
```

## openldr terminology system list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology system list --help
Usage: openldr terminology system list [options]

List all coding systems

Options:
  --publisher <id>  filter by publisher id
  --json            emit JSON (default: false)
  -h, --help        display help for command
EXIT_CODE=0
```

## openldr terminology system create --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology system create --help
Usage: openldr terminology system create [options] <code> <name>

Create a new coding system

Options:
  --url <u>         canonical URL
  --version <v>     system version
  --publisher <id>  publisher id
  --json            emit JSON (default: false)
  -h, --help        display help for command
EXIT_CODE=0
```

## openldr terminology term --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology term --help
Usage: openldr terminology term [options] [command]

Manage terms

Options:
  -h, --help                  display help for command

Commands:
  list [options] <systemUrl>  List terms in a coding system
  help [command]              display help for command
EXIT_CODE=0
```

## openldr terminology term list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology term list --help
Usage: openldr terminology term list [options] <systemUrl>

List terms in a coding system

Options:
  --q <query>  filter by code/display text
  --json       output JSON (default: false)
  -h, --help   display help for command
EXIT_CODE=0
```

## openldr terminology valueset --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology valueset --help
Usage: openldr terminology valueset [options] [command]

Manage value sets

Options:
  -h, --help      display help for command

Commands:
  list [options]  List value sets
  help [command]  display help for command
EXIT_CODE=0
```

## openldr terminology valueset list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology valueset list --help
Usage: openldr terminology valueset list [options]

List value sets

Options:
  --publisher <id>  filter by publisher id
  --json            output JSON (default: false)
  -h, --help        display help for command
EXIT_CODE=0
```

## openldr terminology ontology --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology ontology --help
Usage: openldr terminology ontology [options] [command]

Manage ontology indexes

Options:
  -h, --help                        display help for command

Commands:
  build [options] <systemId> <dir>  Build an ontology index from a server-side
                                    distribution directory
  rebuild [options] <systemId>      Rebuild an ontology index from its recorded
                                    distribution path
  list [options]                    List ontology indexes
  unlink [options] <systemId>       Unlink and delete an ontology index
  help [command]                    display help for command
EXIT_CODE=0
```

## openldr terminology ontology build --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology ontology build --help
Usage: openldr terminology ontology build [options] <systemId> <dir>

Build an ontology index from a server-side distribution directory

Options:
  --json      output JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology ontology rebuild --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology ontology rebuild --help
Usage: openldr terminology ontology rebuild [options] <systemId>

Rebuild an ontology index from its recorded distribution path

Options:
  --json      output JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology ontology list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology ontology list --help
Usage: openldr terminology ontology list [options]

List ontology indexes

Options:
  --json      output JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr terminology ontology unlink --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology ontology unlink --help
Usage: openldr terminology ontology unlink [options] <systemId>

Unlink and delete an ontology index

Options:
  --json      output JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr forms --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms --help
Usage: openldr forms [options] [command]

FHIR forms (Questionnaire) utilities

Options:
  -h, --help                                    display help for command

Commands:
  list [options]                                List persisted form definitions
  extract [options] <questionnaire> <response>  Extract FHIR resources from a filled QuestionnaireResponse
  help [command]                                display help for command
EXIT_CODE=0
```

## openldr forms list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms list --help
Usage: openldr forms list [options]

List persisted form definitions

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr forms extract --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms extract --help
Usage: openldr forms extract [options] <questionnaire> <response>

Extract FHIR resources from a filled QuestionnaireResponse

Options:
  --json           emit the full transaction Bundle JSON (default: false)
  --subject <ref>  subject reference, e.g. Patient/123
  -h, --help       display help for command
EXIT_CODE=0
```

## openldr forms ingest --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms ingest --help
Usage: openldr forms [options] [command]

FHIR forms (Questionnaire) utilities

Options:
  -h, --help                                    display help for command

Commands:
  list [options]                                List persisted form definitions
  extract [options] <questionnaire> <response>  Extract FHIR resources from a filled QuestionnaireResponse
  help [command]                                display help for command
EXIT_CODE=0
```

## openldr pipeline --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline --help
Usage: openldr pipeline [options] [command]

Inspect the ingest pipeline

Options:
  -h, --help                 display help for command

Commands:
  status [options]
  retry [options] <batchId>
  logs [options] <batchId>
  help [command]             display help for command
EXIT_CODE=0
```

## openldr pipeline status --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline status --help
Usage: openldr pipeline status [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr pipeline retry --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline retry --help
Usage: openldr pipeline retry [options] <batchId>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr pipeline logs --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline logs --help
Usage: openldr pipeline logs [options] <batchId>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr queue --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue --help
Usage: openldr queue [options] [command]

Inspect the event queue

Options:
  -h, --help        display help for command

Commands:
  status [options]
  help [command]    display help for command
EXIT_CODE=0
```

## openldr queue status --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue status --help
Usage: openldr queue status [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr provenance --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr provenance --help
Usage: openldr provenance [options] [command]

Provenance tooling

Options:
  -h, --help       display help for command

Commands:
  audit [options]
  help [command]   display help for command
EXIT_CODE=0
```

## openldr provenance audit --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr provenance audit --help
Usage: openldr provenance audit [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr plugin --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin --help
Usage: openldr plugin [options] [command]

Manage WASM ingest plugins

Options:
  -h, --help                display help for command

Commands:
  install [options] <wasm>  Install a plugin (.wasm + manifest.json) into blob
                            + registry
  list [options]
  test [options] <id>
  run [options] <input>     Convert a local input file through a plugin (no
                            queue)
  remove [options] <id>
  help [command]            display help for command
EXIT_CODE=0
```

## openldr plugin install --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install --help
Usage: openldr plugin install [options] <wasm>

Install a plugin (.wasm + manifest.json) into blob + registry

Options:
  --manifest <path>  manifest path (default: manifest.json next to the wasm)
  --json             emit JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr plugin list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin list --help
Usage: openldr plugin list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr plugin test --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin test --help
Usage: openldr plugin test [options] <id>

Options:
  --version <v>  specific version
  --json         emit JSON (default: false)
  -h, --help     display help for command
EXIT_CODE=0
```

## openldr plugin run --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin run --help
Usage: openldr plugin run [options] <input>

Convert a local input file through a plugin (no queue)

Options:
  --plugin <id>  plugin id
  --version <v>  specific version
  --json         emit JSON (default: false)
  -h, --help     display help for command
EXIT_CODE=0
```

## openldr plugin remove --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin remove --help
Usage: openldr plugin remove [options] <id>

Options:
  --version <v>  specific version (default: all)
  --json         emit JSON (default: false)
  -h, --help     display help for command
EXIT_CODE=0
```

## openldr report --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report --help
Usage: openldr report [options] [command]

Domain reports over the analytics DB

Options:
  -h, --help              display help for command

Commands:
  list [options]
  run [options] <id>
  glass-export [options]  Export the GLASS-AMR RIS submission file (CSV)
  help [command]          display help for command
EXIT_CODE=0
```

## openldr report list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report list --help
Usage: openldr report list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr report run --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report run --help
Usage: openldr report run [options] <id>

Options:
  --param <kv...>  parameter as key=value (repeatable)
  --json           emit JSON (default: false)
  --csv            emit CSV (default: false)
  --format <fmt>   json|csv|pdf
  --out <file>     output file (pdf)
  -h, --help       display help for command
EXIT_CODE=0
```

## openldr report glass-export --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report glass-export --help
Usage: openldr report glass-export [options]

Export the GLASS-AMR RIS submission file (CSV)

Options:
  --country <iso3>  ISO3 country code
  --year <yyyy>     reporting year
  --from <date>     window start
  --to <date>       window end
  --out <file>      output CSV file
  --json            emit JSON rows (default: false)
  -h, --help        display help for command
EXIT_CODE=0
```

## openldr audit --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr audit --help
Usage: openldr audit [options] [command]

Append-only audit log

Options:
  -h, --help      display help for command

Commands:
  list [options]
  help [command]  display help for command
EXIT_CODE=0
```

## openldr audit list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr audit list --help
Usage: openldr audit list [options]

Options:
  --actor <id>       filter by actor id
  --entity <t>       filter by entity type
  --entity-type <t>  filter by entity type
  --entity-id <id>   filter by entity id
  --action <a>       filter by action
  --from <iso>       occurred at or after (ISO)
  --to <iso>         occurred at or before (ISO)
  --json             emit JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr users --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr users --help
Usage: openldr users [options] [command]

Local user management

Options:
  -h, --help      display help for command

Commands:
  list [options]
  help [command]  display help for command
EXIT_CODE=0
```

## openldr users list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr users list --help
Usage: openldr users list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr user --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user --help
Usage: openldr user [options] [command]

Local user management (decoupled from the IdP)

Options:
  -h, --help                          display help for command

Commands:
  list [options]
  show [options] <id>
  create [options]
  set-role [options] <id> <roles...>
  activate [options] <id>
  deactivate [options] <id>
  help [command]                      display help for command
EXIT_CODE=0
```

## openldr user list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user list --help
Usage: openldr user list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr user show --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user show --help
Usage: openldr user show [options] <id>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr user create --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user create --help
Usage: openldr user create [options]

Options:
  --username <u>  username (unique)
  --name <n>      display name
  --email <e>     email
  --role <r...>   role (repeatable)
  --json          emit JSON (default: false)
  -h, --help      display help for command
EXIT_CODE=0
```

## openldr user set-role --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user set-role --help
Usage: openldr user set-role [options] <id> <roles...>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr user activate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user activate --help
Usage: openldr user activate [options] <id>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr user deactivate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user deactivate --help
Usage: openldr user deactivate [options] <id>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr export --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr export --help
Usage: openldr export [options]

Export the complete dataset: canonical FHIR (NDJSON + Bundle) + flat-table CSV
+ manifest

Options:
  --out <dir>  output directory (default: "openldr-export")
  --json       emit the manifest as JSON (default: false)
  -h, --help   display help for command
EXIT_CODE=0
```

## openldr dhis2 --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 --help
Usage: openldr dhis2 [options] [command]

DHIS2 aggregate reporting target

Options:
  -h, --help                      display help for command

Commands:
  map                             Manage DHIS2 aggregate mappings
  orgunit                         Manage facility -> DHIS2 orgUnit mappings
  pull-metadata [options]
  validate [options] <mappingId>
  push [options] <mappingId>
  status [options]
  tracker                         DHIS2 tracker (event) push
  schedule                        Scheduled / event-driven push
  help [command]                  display help for command
EXIT_CODE=0
```

## openldr dhis2 map --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map --help
Usage: openldr dhis2 map [options] [command]

Manage DHIS2 aggregate mappings

Options:
  -h, --help               display help for command

Commands:
  import [options] <file>
  list [options]
  help [command]           display help for command
EXIT_CODE=0
```

## openldr dhis2 map import --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map import --help
Usage: openldr dhis2 map import [options] <file>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 map list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map list --help
Usage: openldr dhis2 map list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 orgunit --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit --help
Usage: openldr dhis2 orgunit [options] [command]

Manage facility -> DHIS2 orgUnit mappings

Options:
  -h, --help               display help for command

Commands:
  import [options] <file>
  list [options]
  help [command]           display help for command
EXIT_CODE=0
```

## openldr dhis2 orgunit import --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit import --help
Usage: openldr dhis2 orgunit import [options] <file>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 orgunit list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit list --help
Usage: openldr dhis2 orgunit list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 pull-metadata --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 pull-metadata --help
Usage: openldr dhis2 pull-metadata [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 validate --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 validate --help
Usage: openldr dhis2 validate [options] <mappingId>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 push --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push --help
Usage: openldr dhis2 push [options] <mappingId>

Options:
  --period <p>  DHIS2 period, e.g. 2026Q1
  --dry-run     preview payload without sending (default: false)
  --json        emit JSON (default: false)
  -h, --help    display help for command
EXIT_CODE=0
```

## openldr dhis2 status --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 status --help
Usage: openldr dhis2 status [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 tracker --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 tracker --help
Usage: openldr dhis2 tracker [options] [command]

DHIS2 tracker (event) push

Options:
  -h, --help                  display help for command

Commands:
  push [options] <mappingId>
  help [command]              display help for command
EXIT_CODE=0
```

## openldr dhis2 tracker push --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 tracker push --help
Usage: openldr dhis2 tracker push [options] <mappingId>

Options:
  --period <p>  DHIS2 period, e.g. 2026Q1
  --dry-run     preview events without sending (default: false)
  --json        emit JSON (default: false)
  -h, --help    display help for command
EXIT_CODE=0
```

## openldr dhis2 schedule --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule --help
Usage: openldr dhis2 schedule [options] [command]

Scheduled / event-driven push

Options:
  -h, --help                     display help for command

Commands:
  add [options] <mappingId>
  list [options]
  remove [options] <scheduleId>
  help [command]                 display help for command
EXIT_CODE=0
```

## openldr dhis2 schedule add --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add --help
Usage: openldr dhis2 schedule add [options] <mappingId>

Options:
  --mode <m>         aggregate|tracker
  --period-type <t>  monthly|quarterly|yearly
  --event-driven     also push on ingest (tracker) (default: false)
  --json             emit JSON (default: false)
  -h, --help         display help for command
EXIT_CODE=0
```

## openldr dhis2 schedule list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule list --help
Usage: openldr dhis2 schedule list [options]

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr dhis2 schedule remove --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule remove --help
Usage: openldr dhis2 schedule remove [options] <scheduleId>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market --help
Usage: openldr market [options] [command]

Plugin/artifact marketplace

Options:
  -h, --help                         display help for command

Commands:
  verify [options] <dir>             Verify a bundle directory (manifest + wasm
                                     + publisher.pub)
  install [options] <dir>            Install a bundle from a directory into the
                                     plugin registry
  update [options] <dir>             Update (re-install) a bundle from a
                                     directory
  list [options]                     List installed marketplace plugins
  rollback [options] <id> <version>  Activate a previously installed version of
                                     a plugin
  enable [options] <id>              Enable a plugin
  disable [options] <id>             Disable a plugin (hidden from load)
  remove [options] <id> [version]    Remove a plugin (all versions or a
                                     specific one)
  help [command]                     display help for command
EXIT_CODE=0
```

## openldr market verify --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market verify --help
Usage: openldr market verify [options] <dir>

Verify a bundle directory (manifest + wasm + publisher.pub)

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market install --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market install --help
Usage: openldr market install [options] <dir>

Install a bundle from a directory into the plugin registry

Options:
  --approve              approve the capability grant (default: false)
  --approved-by <actor>  actor granting approval (default: cli)
  --json                 emit JSON (default: false)
  -h, --help             display help for command
EXIT_CODE=0
```

## openldr market update --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market update --help
Usage: openldr market update [options] <dir>

Update (re-install) a bundle from a directory

Options:
  --approve              approve the capability grant (default: false)
  --approved-by <actor>  actor granting approval (default: cli)
  --json                 emit JSON (default: false)
  -h, --help             display help for command
EXIT_CODE=0
```

## openldr market list --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market list --help
Usage: openldr market list [options]

List installed marketplace plugins

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market rollback --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market rollback --help
Usage: openldr market rollback [options] <id> <version>

Activate a previously installed version of a plugin

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market enable --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market enable --help
Usage: openldr market enable [options] <id>

Enable a plugin

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market disable --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market disable --help
Usage: openldr market disable [options] <id>

Disable a plugin (hidden from load)

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr market remove --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market remove --help
Usage: openldr market remove [options] <id> [version]

Remove a plugin (all versions or a specific one)

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr artifact --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact --help
Usage: openldr artifact [options] [command]

Author marketplace artifacts (scaffold/build/sign/publish)

Options:
  -h, --help                     display help for command

Commands:
  keygen [options]
  new [options] <type> <name>    scaffold plugin|form|report
  build [options] <dir>
  pack [options] <dir>
  sign [options] <dir>
  test [options] <dir>
  publish [options] <bundleDir>
  help [command]                 display help for command
EXIT_CODE=0
```

## openldr artifact keygen --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact keygen --help
Usage: openldr artifact keygen [options]

Options:
  --out <dir>  output directory for the keypair
  --force      overwrite an existing key (default: false)
  --json       emit JSON (default: false)
  -h, --help   display help for command
EXIT_CODE=0
```

## openldr artifact new --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact new --help
Usage: openldr artifact new [options] <type> <name>

scaffold plugin|form|report

Options:
  --out <dir>          parent directory (default: ".")
  --publisher-id <id>
  --sdk-path <p>
  --sdk-git <url>
  --json               emit JSON (default: false)
  -h, --help           display help for command
EXIT_CODE=0
```

## openldr artifact build --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact build --help
Usage: openldr artifact build [options] <dir>

Options:
  --json      emit JSON (default: false)
  -h, --help  display help for command
EXIT_CODE=0
```

## openldr artifact pack --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact pack --help
Usage: openldr artifact pack [options] <dir>

Options:
  --key <priv>  publisher private key
  --out <dir>   bundle output dir
  --json        emit JSON (default: false)
  -h, --help    display help for command
EXIT_CODE=0
```

## openldr artifact sign --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact sign --help
Usage: openldr artifact sign [options] <dir>

Options:
  --key <priv>
  --json        emit JSON (default: false)
  -h, --help    display help for command
EXIT_CODE=0
```

## openldr artifact test --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact test --help
Usage: openldr artifact test [options] <dir>

Options:
  --sample <file>
  --json           emit JSON (default: false)
  -h, --help       display help for command
EXIT_CODE=0
```

## openldr artifact publish --help

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact publish --help
Usage: openldr artifact publish [options] <bundleDir>

Options:
  --to <registryDir>
  --install              also install into the running CE (default: false)
  --approve              approve requested capabilities on install (default:
                         false)
  --approved-by <actor>
  --json                 emit JSON (default: false)
  -h, --help             display help for command
EXIT_CODE=0
```

