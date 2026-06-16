import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { exitCodeFor, formatHealthTable } from './format';
import { redactError } from './redact-error';
import { runFhirValidate, formatFhirValidate } from './fhir';
import { runDbMigrate, runDbReset, runDbSeed } from './db';
import { runFormsExtract } from './forms';
import { runIngest, runPipelineStatus, runPipelineRetry, runPipelineLogs, runQueueStatus, runProvenanceAudit } from './ingest';
import { runPluginInstall, runPluginList, runPluginTest, runPluginRun, runPluginRemove } from './plugin';
import { runReportList, runReportRun, runReportGlassExport } from './report';
import { runAuditList } from './audit';
import { runUserList, runUserShow, runUserCreate, runUserSetRole, runUserSetStatus } from './user';
import { runExport } from './export';
import { runTargetStoreTest } from './target-store';
import { runTerminologyImport, runTerminologyLookup, runTerminologyValidate, runTerminologyExpand, runTerminologyTranslate, runPublisherList, runPublisherCreate, runSystemList, runSystemCreate, runTermList, runValueSetList, runOntologyBuild, runOntologyRebuild, runOntologyList, runOntologyUnlink } from './terminology';
import { runDhis2MapImport, runDhis2MapList, runDhis2OrgUnitImport, runDhis2OrgUnitList, runDhis2PullMetadata, runDhis2Validate, runDhis2Push, runDhis2Status, runDhis2ScheduleAdd, runDhis2ScheduleList, runDhis2ScheduleRemove } from './dhis2';

const program = new Command();
program.name('openldr').description('OpenLDR CE operator CLI');

program
  .command('health')
  .description('Probe every adapter (auth, blob, eventing, target-store)')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { json: boolean }) => {
    let ctx;
    try {
      const cfg = loadConfig();
      ctx = await createAppContext(cfg);
      const result = await ctx.health.runAll();
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatHealthTable(result) + '\n');
      }
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ status: 'down', error: redactError(err) }) + '\n');
      } else {
        process.stderr.write(`health failed: ${redactError(err)}\n`);
      }
      process.exitCode = 1;
    } finally {
      await ctx?.close();
    }
  });

const fhir = program.command('fhir').description('FHIR R4 utilities');
fhir
  .command('validate <file>')
  .description('Validate a FHIR R4 resource or Bundle against the CE schemas')
  .option('--json', 'emit OperationOutcome JSON', false)
  .action((file: string, opts: { json: boolean }) => {
    try {
      const out = runFhirValidate(file);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      } else {
        process.stdout.write(formatFhirValidate(out) + '\n');
      }
      process.exitCode = out.allValid ? 0 : 1;
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ error: redactError(err) }) + '\n');
      } else {
        process.stderr.write(`fhir validate failed: ${redactError(err)}\n`);
      }
      process.exitCode = 1;
    }
  });

const db = program.command('db').description('Database migrations and seeding');
db.command('migrate')
  .description('Run internal + external migrations to latest')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try {
      process.exitCode = await runDbMigrate(opts);
    } catch (err) {
      process.stderr.write(`db migrate failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });
db.command('reset')
  .description('Drop and re-run all migrations (refuses in production without --force)')
  .option('--json', 'emit JSON', false)
  .option('--force', 'allow in production', false)
  .action(async (opts: { json: boolean; force: boolean }) => {
    try {
      process.exitCode = await runDbReset(opts);
    } catch (err) {
      process.stderr.write(`db reset failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });
db.command('seed')
  .description('Insert a small sample data set')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try {
      process.exitCode = await runDbSeed(opts);
    } catch (err) {
      process.stderr.write(`db seed failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });

const targetStore = program.command('target-store').description('Target warehouse (Postgres/SQL Server) tools');
targetStore
  .command('test')
  .description('Probe the target store connection')
  .option('--engine <engine>', 'postgres|mssql (defaults to TARGET_STORE_ADAPTER)')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { engine?: string; json: boolean }) => {
    process.exitCode = await runTargetStoreTest(opts);
  });

const term = program.command('terminology').description('Terminology service (CodeSystem/ValueSet/ConceptMap)');
term.command('import <kind> <path>').description('import loinc|amr|resource').option('--accept-license', 'accept the LOINC license', false).option('--json', 'emit JSON', false)
  .action(async (kind: string, path: string, opts: { acceptLicense: boolean; json: boolean }) => { process.exitCode = await runTerminologyImport(kind, path, opts); });
term.command('lookup <system> <code>').option('--json', 'emit JSON', false)
  .action(async (system: string, code: string, opts: { json: boolean }) => { process.exitCode = await runTerminologyLookup(system, code, opts); });
term.command('validate-code').requiredOption('--code <code>').option('--system <system>').option('--valueset <url>').option('--json', 'emit JSON', false)
  .action(async (opts: { system?: string; code: string; valueset?: string; json: boolean }) => { process.exitCode = await runTerminologyValidate(opts); });
term.command('expand <valueSetUrl>').option('--count <n>').option('--offset <n>').option('--json', 'emit JSON', false)
  .action(async (url: string, opts: { count?: string; offset?: string; json: boolean }) => { process.exitCode = await runTerminologyExpand(url, opts); });
term.command('translate <conceptMapUrl>').requiredOption('--system <system>').requiredOption('--code <code>').option('--json', 'emit JSON', false)
  .action(async (url: string, opts: { system: string; code: string; json: boolean }) => { process.exitCode = await runTerminologyTranslate(url, opts); });

const tpub = term.command('publisher').description('Manage terminology publishers');
tpub.command('list').description('List all publishers').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runPublisherList(opts); } catch (err) { process.stderr.write(`terminology publisher list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
tpub.command('create <name>').description('Create a new publisher').option('--role <r>', 'local|external', 'local').option('--icon <i>', 'icon name').option('--json', 'emit JSON', false)
  .action(async (name: string, opts: { role?: 'local' | 'external'; icon?: string; json: boolean }) => {
    try { process.exitCode = await runPublisherCreate(name, opts); } catch (err) { process.stderr.write(`terminology publisher create failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const tsys = term.command('system').description('Manage coding systems');
tsys.command('list').description('List all coding systems').option('--publisher <id>', 'filter by publisher id').option('--json', 'emit JSON', false)
  .action(async (opts: { publisher?: string; json: boolean }) => {
    try { process.exitCode = await runSystemList(opts); } catch (err) { process.stderr.write(`terminology system list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
tsys.command('create <code> <name>').description('Create a new coding system').option('--url <u>', 'canonical URL').option('--version <v>', 'system version').option('--publisher <id>', 'publisher id').option('--json', 'emit JSON', false)
  .action(async (code: string, name: string, opts: { url?: string; version?: string; publisher?: string; json: boolean }) => {
    try { process.exitCode = await runSystemCreate(code, name, opts); } catch (err) { process.stderr.write(`terminology system create failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const tterm = term.command('term').description('Manage terms');
tterm.command('list <systemUrl>').description('List terms in a coding system').option('--q <query>', 'filter by code/display text').option('--json', 'output JSON', false)
  .action(async (systemUrl: string, opts: { q?: string; json: boolean }) => {
    try { process.exitCode = await runTermList(systemUrl, opts); } catch (err) { process.stderr.write(`terminology term list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const tvs = term.command('valueset').description('Manage value sets');
tvs.command('list').description('List value sets').option('--publisher <id>', 'filter by publisher id').option('--json', 'output JSON', false)
  .action(async (opts: { publisher?: string; json: boolean }) => {
    try { process.exitCode = await runValueSetList(opts); } catch (err) { process.stderr.write(`terminology valueset list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const tont = term.command('ontology').description('Manage ontology indexes');
tont.command('build <systemId> <dir>').description('Build an ontology index from a server-side distribution directory').option('--json', 'output JSON', false)
  .action(async (systemId: string, dir: string, opts: { json: boolean }) => {
    try { process.exitCode = await runOntologyBuild(systemId, dir, opts); } catch (err) { process.stderr.write(`terminology ontology build failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
tont.command('rebuild <systemId>').description('Rebuild an ontology index from its recorded distribution path').option('--json', 'output JSON', false)
  .action(async (systemId: string, opts: { json: boolean }) => {
    try { process.exitCode = await runOntologyRebuild(systemId, opts); } catch (err) { process.stderr.write(`terminology ontology rebuild failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
tont.command('list').description('List ontology indexes').option('--json', 'output JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runOntologyList(opts); } catch (err) { process.stderr.write(`terminology ontology list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
tont.command('unlink <systemId>').description('Unlink and delete an ontology index').option('--json', 'output JSON', false)
  .action(async (systemId: string, opts: { json: boolean }) => {
    try { process.exitCode = await runOntologyUnlink(systemId, opts); } catch (err) { process.stderr.write(`terminology ontology unlink failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const forms = program.command('forms').description('FHIR forms (Questionnaire) utilities');
forms
  .command('extract <questionnaire> <response>')
  .description('Extract FHIR resources from a filled QuestionnaireResponse')
  .option('--json', 'emit the full transaction Bundle JSON', false)
  .option('--subject <ref>', 'subject reference, e.g. Patient/123')
  .action((questionnaire: string, response: string, opts: { json: boolean; subject?: string }) => {
    try {
      const ctx = opts.subject ? { subject: { reference: opts.subject } } : {};
      const out = runFormsExtract(questionnaire, response, ctx);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out.bundle, null, 2) + '\n');
      } else {
        process.stdout.write(`extracted [${out.resourceTypes.join(', ')}]; invalid: ${out.invalidCount}\n`);
      }
      process.exitCode = out.invalidCount === 0 ? 0 : 1;
    } catch (err) {
      process.stderr.write(`forms extract failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('ingest <file>')
  .description('Ingest a payload through the pipeline (accept + drain)')
  .option('--source <s>', 'source system identifier', 'cli')
  .option('--converter <id>', 'converter id', 'fhir-bundle')
  .option('--plugin <id>', 'plugin/converter id (alias of --converter)')
  .option('--config <file>', 'plugin config JSON (e.g. tabular column mapping)')
  .option('--json', 'emit JSON', false)
  .action(async (file: string, opts: { source: string; converter: string; plugin?: string; config?: string; json: boolean }) => {
    if (opts.plugin) opts.converter = opts.plugin;
    try {
      process.exitCode = await runIngest(file, opts);
    } catch (err) {
      process.stderr.write(`ingest failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });

const pipeline = program.command('pipeline').description('Inspect the ingest pipeline');
pipeline.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineStatus(opts); } catch (err) { process.stderr.write(`pipeline status failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
pipeline.command('retry <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineRetry(batchId, opts); } catch (err) { process.stderr.write(`pipeline retry failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
pipeline.command('logs <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineLogs(batchId, opts); } catch (err) { process.stderr.write(`pipeline logs failed: ${redactError(err)}\n`); process.exitCode = 1; }
});

const queue = program.command('queue').description('Inspect the event queue');
queue.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runQueueStatus(opts); } catch (err) { process.stderr.write(`queue status failed: ${redactError(err)}\n`); process.exitCode = 1; }
});

const provenance = program.command('provenance').description('Provenance tooling');
provenance.command('audit').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runProvenanceAudit(opts); } catch (err) { process.stderr.write(`provenance audit failed: ${redactError(err)}\n`); process.exitCode = 1; }
});

const plugin = program.command('plugin').description('Manage WASM ingest plugins');
plugin
  .command('install <wasm>')
  .description('Install a plugin (.wasm + manifest.json) into blob + registry')
  .option('--manifest <path>', 'manifest path (default: manifest.json next to the wasm)')
  .option('--json', 'emit JSON', false)
  .action(async (wasm: string, opts: { manifest?: string; json: boolean }) => {
    try { process.exitCode = await runPluginInstall(wasm, opts); } catch (err) { process.stderr.write(`plugin install failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('list')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runPluginList(opts); } catch (err) { process.stderr.write(`plugin list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('test <id>')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginTest(id, opts); } catch (err) { process.stderr.write(`plugin test failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('run <input>')
  .description('Convert a local input file through a plugin (no queue)')
  .requiredOption('--plugin <id>', 'plugin id')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (input: string, opts: { plugin: string; version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRun(input, opts); } catch (err) { process.stderr.write(`plugin run failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('remove <id>')
  .option('--version <v>', 'specific version (default: all)')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRemove(id, opts); } catch (err) { process.stderr.write(`plugin remove failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const report = program.command('report').description('Domain reports over the analytics DB');
report.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportList(opts); } catch (err) { process.stderr.write(`report list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
report
  .command('run <id>')
  .option('--param <kv...>', 'parameter as key=value (repeatable)')
  .option('--json', 'emit JSON', false)
  .option('--csv', 'emit CSV', false)
  .option('--format <fmt>', 'json|csv|pdf')
  .option('--out <file>', 'output file (pdf)')
  .action(async (id: string, opts: { param?: string[]; json: boolean; csv: boolean; format?: string; out?: string }) => {
    try { process.exitCode = await runReportRun(id, opts); } catch (err) { process.stderr.write(`report run failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
report.command('glass-export').description('Export the GLASS-AMR RIS submission file (CSV)')
  .requiredOption('--country <iso3>', 'ISO3 country code').requiredOption('--year <yyyy>', 'reporting year')
  .option('--from <date>', 'window start').option('--to <date>', 'window end').option('--out <file>', 'output CSV file').option('--json', 'emit JSON rows', false)
  .action(async (o: { country: string; year: string; from?: string; to?: string; out?: string; json: boolean }) => { process.exitCode = await runReportGlassExport(o); });

const audit = program.command('audit').description('Append-only audit log');
audit
  .command('list')
  .option('--actor <id>', 'filter by actor id')
  .option('--entity-type <t>', 'filter by entity type')
  .option('--entity-id <id>', 'filter by entity id')
  .option('--action <a>', 'filter by action')
  .option('--from <iso>', 'occurred at or after (ISO)')
  .option('--to <iso>', 'occurred at or before (ISO)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { actor?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; json: boolean }) => {
    try { process.exitCode = await runAuditList(opts); } catch (err) { process.stderr.write(`audit list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const user = program.command('user').description('Local user management (decoupled from the IdP)');
user.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runUserList(opts); } catch (err) { process.stderr.write(`user list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
user.command('show <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserShow(id, opts); } catch (err) { process.stderr.write(`user show failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
user
  .command('create')
  .requiredOption('--username <u>', 'username (unique)')
  .option('--name <n>', 'display name')
  .option('--email <e>', 'email')
  .option('--role <r...>', 'role (repeatable)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { username: string; name?: string; email?: string; role?: string[]; json: boolean }) => {
    try { process.exitCode = await runUserCreate(opts); } catch (err) { process.stderr.write(`user create failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
user.command('set-role <id> <roles...>').option('--json', 'emit JSON', false).action(async (id: string, roles: string[], opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetRole(id, roles, opts); } catch (err) { process.stderr.write(`user set-role failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
user.command('activate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'active', opts); } catch (err) { process.stderr.write(`user activate failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
user.command('deactivate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'disabled', opts); } catch (err) { process.stderr.write(`user deactivate failed: ${redactError(err)}\n`); process.exitCode = 1; }
});

program
  .command('export')
  .description('Export the complete dataset: canonical FHIR (NDJSON + Bundle) + flat-table CSV + manifest')
  .option('--out <dir>', 'output directory', 'openldr-export')
  .option('--json', 'emit the manifest as JSON', false)
  .action(async (opts: { out: string; json: boolean }) => {
    try {
      process.exitCode = await runExport(opts);
    } catch (err) {
      process.stderr.write(`export failed: ${redactError(err)}\n`);
      process.exitCode = 1;
    }
  });

const dhis2 = program.command('dhis2').description('DHIS2 aggregate reporting target');
const dmap = dhis2.command('map').description('Manage DHIS2 aggregate mappings');
dmap.command('import <file>').option('--json', 'emit JSON', false).action(async (file: string, o: { json: boolean }) => { process.exitCode = await runDhis2MapImport(file, o); });
dmap.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2MapList(o); });
const dou = dhis2.command('orgunit').description('Manage facility -> DHIS2 orgUnit mappings');
dou.command('import <file>').option('--json', 'emit JSON', false).action(async (file: string, o: { json: boolean }) => { process.exitCode = await runDhis2OrgUnitImport(file, o); });
dou.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2OrgUnitList(o); });
dhis2.command('pull-metadata').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2PullMetadata(o); });
dhis2.command('validate <mappingId>').option('--json', 'emit JSON', false).action(async (id: string, o: { json: boolean }) => { process.exitCode = await runDhis2Validate(id, o); });
dhis2.command('push <mappingId>').requiredOption('--period <p>', 'DHIS2 period, e.g. 2026Q1').option('--dry-run', 'preview payload without sending', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { period: string; dryRun: boolean; json: boolean }) => { process.exitCode = await runDhis2Push(id, o); });
dhis2.command('status').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2Status(o); });

const dtracker = dhis2.command('tracker').description('DHIS2 tracker (event) push');
dtracker.command('push <mappingId>').requiredOption('--period <p>', 'DHIS2 period, e.g. 2026Q1').option('--dry-run', 'preview events without sending', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { period: string; dryRun: boolean; json: boolean }) => { process.exitCode = await runDhis2Push(id, o); });
const dsched = dhis2.command('schedule').description('Scheduled / event-driven push');
dsched.command('add <mappingId>').requiredOption('--mode <m>', 'aggregate|tracker').requiredOption('--period-type <t>', 'monthly|quarterly|yearly').option('--event-driven', 'also push on ingest (tracker)', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { mode: string; periodType: string; eventDriven: boolean; json: boolean }) => { process.exitCode = await runDhis2ScheduleAdd(id, o); });
dsched.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2ScheduleList(o); });
dsched.command('remove <scheduleId>').option('--json', 'emit JSON', false).action(async (id: string, o: { json: boolean }) => { process.exitCode = await runDhis2ScheduleRemove(id, o); });

program.parseAsync(process.argv);
