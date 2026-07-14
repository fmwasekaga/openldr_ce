import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { exitCodeFor, formatHealthTable } from './format';
import { redactError } from './redact-error';
import { runFhirValidate, formatFhirValidate } from './fhir';
import { runDbMigrate, runDbReset, runDbSeed } from './db';
import { runFormsExtract, runFormsList } from './forms';
import { runList as runReportDesignList, runDelete as runReportDesignDelete } from './report-design';
import { runList as runReportDefList, runDelete as runReportDefDelete } from './report-def';
import { runIngest, runPipelineStatus, runPipelineRetry, runPipelineLogs, runQueueStatus, runProvenanceAudit } from './ingest';
import { runPluginInstall, runPluginList, runPluginTest, runPluginRun, runPluginRemove } from './plugin';
import { runReportList, runReportRun, runReportGlassExport } from './report';
import { runAuditList } from './audit';
import { runUserList, runUsersList, runUserShow, runUserCreate, runUserSetRole, runUserSetStatus } from './user';
import { runExport } from './export';
import { runTargetStoreTest } from './target-store';
import { runTerminologyImport, runTerminologyLookup, runTerminologyValidate, runTerminologyExpand, runTerminologyTranslate, runPublisherList, runPublisherCreate, runSystemList, runSystemCreate, runTermList, runValueSetList, runOntologyBuild, runOntologyRebuild, runOntologyList, runOntologyUnlink } from './terminology';
import { runMarketVerify, runMarketInstall, runMarketList, runMarketRollback, runMarketEnable, runMarketDisable, runMarketRemove } from './market';
import { runArtifactKeygen, runArtifactNew, runArtifactBuild, runArtifactPack, runArtifactSign, runArtifactTest, runArtifactPublish } from './artifact';
import { runSettingsFlagsList, runSettingsFlagsSet, runSettingsDanger, runSettingsSyncShow, runSettingsSyncSet, runSettingsNumbersList, runSettingsNumbersSet } from './settings';
import { runSyncStatus, runSyncNow, runSyncEnroll, runSyncList, runSyncRotate, runSyncRevoke, runSyncExport, runSyncImport } from './sync';
import { runErrorsList } from './errors';

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

const errors = program.command('errors').description('Error-code catalog');
errors
  .command('list')
  .description('List the OpenLDR CE error codes (code, http status, message)')
  .option('--json', 'emit machine-readable JSON', false)
  .action((opts: { json: boolean }) => { process.exitCode = runErrorsList(opts); });

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

const settings = program.command('settings').description('App settings — feature flags and danger-zone actions');
const flags = settings.command('flags').description('Feature flags');
flags.command('list').description('List all feature flags and their values').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsFlagsList(opts); } catch (err) { process.stderr.write(`settings flags list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
flags.command('set <key> <value>').description('Set a feature flag (value: true|false)').option('--json', 'emit JSON', false)
  .action(async (key: string, value: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsFlagsSet(key, value, opts); } catch (err) { process.stderr.write(`settings flags set failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
const numbers = settings.command('numbers').description('Operational number settings (limits & tuning)');
numbers.command('list').description('List number settings and their values').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsNumbersList(opts); } catch (err) { process.stderr.write(`settings numbers list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
numbers.command('set <key> <value>').description('Set a number setting (clamped into its range)').option('--json', 'emit JSON', false)
  .action(async (key: string, value: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsNumbersSet(key, value, opts); } catch (err) { process.stderr.write(`settings numbers set failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
const sync = settings.command('sync').description('Lab⇄central sync config (writes the discrete sync.* keys the workers read)');
sync.command('show').description('Show the current sync configuration').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsSyncShow(opts); } catch (err) { process.stderr.write(`settings sync show failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
sync.command('set <field> <value>').description('Set a sync field: enabled|mode|centralUrl|siteId|oidcIssuer|clientId|clientSecret|intervalMinutes').option('--json', 'emit JSON', false)
  .action(async (field: string, value: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSettingsSyncSet(field, value, opts); } catch (err) { process.stderr.write(`settings sync set failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
settings.command('danger <action>')
  .description('Run a danger-zone action: reset-dashboards | clear-audit | factory-reset (internal DB only)')
  .option('--force', 'required — confirms the destructive action', false)
  .option('--json', 'emit JSON', false)
  .action(async (action: string, opts: { force: boolean; json: boolean }) => {
    try { process.exitCode = await runSettingsDanger(action, opts); } catch (err) { process.stderr.write(`settings danger failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const syncGroup = program.command('sync').description('lab⇄central sync status + control');
syncGroup.command('status').description('Show live sync status (workers, cursors, pending backlog)').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSyncStatus(opts); } catch (err) { process.stderr.write(`sync status failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('now').description('Trigger a sync pass now (fails if sync is disabled)').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSyncNow(opts); } catch (err) { process.stderr.write(`sync now failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('enroll <siteId>').description('Enroll a lab (central): mint a Keycloak client + registry row, print the secret once')
  .option('--name <name>', 'human-readable site name').option('--central-url <url>', 'central public base URL the lab will sync to (required)').option('--json', 'emit JSON', false)
  .action(async (siteId: string, opts: { name?: string; centralUrl?: string; json: boolean }) => {
    try { process.exitCode = await runSyncEnroll(siteId, opts); } catch (err) { process.stderr.write(`sync enroll failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('list').description('List enrolled sites (never shows secrets)').option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runSyncList(opts); } catch (err) { process.stderr.write(`sync list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('rotate <siteId>').description('Rotate a site client secret (prints the new secret once)').option('--json', 'emit JSON', false)
  .action(async (siteId: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSyncRotate(siteId, opts); } catch (err) { process.stderr.write(`sync rotate failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('revoke <siteId>').description('Revoke a site (delete its client + mark the row revoked; idempotent)').option('--json', 'emit JSON', false)
  .action(async (siteId: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSyncRevoke(siteId, opts); } catch (err) { process.stderr.write(`sync revoke failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('export').description('Write a signed offline sync bundle to a file (lab→push, central→pull with --site)')
  .option('--kind <kind>', 'push|pull (default: pull if --site is given, else push)').option('--site <id>', 'site id (required for a pull export)').option('--from <seq>', 'push: start cursor (default: safe frontier)').option('--out <file>', 'output bundle path').option('--json', 'emit the bundle manifest as JSON', false)
  .action(async (opts: { kind?: 'push' | 'pull'; site?: string; from?: string; out?: string; json: boolean }) => {
    try { process.exitCode = await runSyncExport(opts); } catch (err) { process.stderr.write(`sync export failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
syncGroup.command('import <file>').description('Apply a signed offline sync bundle (dispatches on the bundle kind)').option('--json', 'emit JSON', false)
  .action(async (file: string, opts: { json: boolean }) => {
    try { process.exitCode = await runSyncImport(file, opts); } catch (err) { process.stderr.write(`sync import failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const targetStore = program.command('target-store').description('Target warehouse (Postgres/SQL Server/MySQL/MariaDB) tools');
targetStore
  .command('test')
  .description('Probe the target store connection')
  .option('--engine <engine>', 'postgres|mssql|mysql (defaults to TARGET_STORE_ADAPTER)')
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
forms.command('list').description('List persisted form definitions').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runFormsList(opts); } catch (err) { process.stderr.write(`forms list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
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

const reportDesign = program.command('report-design').description('Report Designer page designs');
reportDesign.command('list').description('List report designs').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportDesignList(opts); } catch (err) { process.stderr.write(`report-design list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
reportDesign.command('delete <id>').description('Delete a report design (destructive)').option('--force', 'confirm deletion', false).action(async (id: string, opts: { force: boolean }) => {
  try { process.exitCode = await runReportDesignDelete(id, opts); } catch (err) { process.stderr.write(`report-design delete failed: ${redactError(err)}\n`); process.exitCode = 1; }
});

const reportDef = program.command('report-def').description('Data-driven report definitions');
reportDef.command('list').description('List report definitions').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportDefList(opts); } catch (err) { process.stderr.write(`report-def list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
reportDef.command('delete <id>').description('Delete a report definition (destructive)').option('--force', 'confirm deletion', false).action(async (id: string, opts: { force: boolean }) => {
  try { process.exitCode = await runReportDefDelete(id, opts); } catch (err) { process.stderr.write(`report-def delete failed: ${redactError(err)}\n`); process.exitCode = 1; }
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
  .option('--entity <t>', 'filter by entity type')
  .option('--entity-type <t>', 'filter by entity type')
  .option('--entity-id <id>', 'filter by entity id')
  .option('--action <a>', 'filter by action')
  .option('--from <iso>', 'occurred at or after (ISO)')
  .option('--to <iso>', 'occurred at or before (ISO)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { actor?: string; entity?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; json: boolean }) => {
    try { process.exitCode = await runAuditList(opts); } catch (err) { process.stderr.write(`audit list failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });

const users = program.command('users').description('Local user management');
users.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runUsersList(opts); } catch (err) { process.stderr.write(`users list failed: ${redactError(err)}\n`); process.exitCode = 1; }
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

const market = program.command('market').description('Plugin/artifact marketplace');
market
  .command('verify <dir>')
  .description('Verify a bundle directory (manifest + wasm + publisher.pub)')
  .option('--json', 'emit JSON', false)
  .action(async (dir: string, opts: { json: boolean }) => {
    try { process.exitCode = await runMarketVerify(dir, opts); } catch (err) { process.stderr.write(`market verify failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('install <dir>')
  .description('Install a bundle from a directory into the plugin registry')
  .option('--approve', 'approve the capability grant', false)
  .option('--approved-by <actor>', 'actor granting approval (default: cli)')
  .option('--json', 'emit JSON', false)
  .action(async (dir: string, opts: { approve: boolean; approvedBy?: string; json: boolean }) => {
    try { process.exitCode = await runMarketInstall(dir, opts); } catch (err) { process.stderr.write(`market install failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('update <dir>')
  .description('Update (re-install) a bundle from a directory')
  .option('--approve', 'approve the capability grant', false)
  .option('--approved-by <actor>', 'actor granting approval (default: cli)')
  .option('--json', 'emit JSON', false)
  .action(async (dir: string, opts: { approve: boolean; approvedBy?: string; json: boolean }) => {
    try { process.exitCode = await runMarketInstall(dir, opts); } catch (err) { process.stderr.write(`market update failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('list')
  .description('List installed marketplace plugins')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runMarketList(opts); } catch (err) { process.stderr.write(`market list failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('rollback <id> <version>')
  .description('Activate a previously installed version of a plugin')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, version: string, opts: { json: boolean }) => {
    try { process.exitCode = await runMarketRollback(id, version, opts); } catch (err) { process.stderr.write(`market rollback failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('enable <id>')
  .description('Enable a plugin')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    try { process.exitCode = await runMarketEnable(id, opts); } catch (err) { process.stderr.write(`market enable failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('disable <id>')
  .description('Disable a plugin (hidden from load)')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    try { process.exitCode = await runMarketDisable(id, opts); } catch (err) { process.stderr.write(`market disable failed: ${String(err)}\n`); process.exitCode = 1; }
  });
market
  .command('remove <id> [version]')
  .description('Remove a plugin (all versions or a specific one)')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, version: string | undefined, opts: { json: boolean }) => {
    try { process.exitCode = await runMarketRemove(id, version, opts); } catch (err) { process.stderr.write(`market remove failed: ${String(err)}\n`); process.exitCode = 1; }
  });

const artifact = program.command('artifact').description('Author marketplace artifacts (scaffold/build/sign/publish)');
artifact.command('keygen').requiredOption('--out <dir>', 'output directory for the keypair').option('--force', 'overwrite an existing key', false).option('--json', 'emit JSON', false)
  .action(async (o: { out: string; force: boolean; json: boolean }) => { process.exitCode = await runArtifactKeygen(o); });
artifact.command('new <type> <name>').description('scaffold plugin|form|report').option('--out <dir>', 'parent directory', '.').option('--publisher-id <id>').option('--sdk-path <p>').option('--sdk-git <url>').option('--json', 'emit JSON', false)
  .action(async (type: string, name: string, o: { out?: string; publisherId?: string; sdkPath?: string; sdkGit?: string; json: boolean }) => { process.exitCode = await runArtifactNew(type, name, o); });
artifact.command('build <dir>').option('--json', 'emit JSON', false).action(async (dir: string, o: { json: boolean }) => { process.exitCode = await runArtifactBuild(dir, o); });
artifact.command('pack <dir>').requiredOption('--key <priv>', 'publisher private key').option('--out <dir>', 'bundle output dir').option('--json', 'emit JSON', false)
  .action(async (dir: string, o: { key: string; out?: string; json: boolean }) => { process.exitCode = await runArtifactPack(dir, o); });
artifact.command('sign <dir>').requiredOption('--key <priv>').option('--json', 'emit JSON', false).action(async (dir: string, o: { key: string; json: boolean }) => { process.exitCode = await runArtifactSign(dir, o); });
artifact.command('test <dir>').requiredOption('--sample <file>').option('--json', 'emit JSON', false).action(async (dir: string, o: { sample: string; json: boolean }) => { process.exitCode = await runArtifactTest(dir, o); });
artifact.command('publish <bundleDir>').requiredOption('--to <registryDir>').option('--install', 'also install into the running CE', false).option('--approve', 'approve requested capabilities on install', false).option('--approved-by <actor>').option('--json', 'emit JSON', false)
  .action(async (bundleDir: string, o: { to: string; install: boolean; approve: boolean; approvedBy?: string; json: boolean }) => { process.exitCode = await runArtifactPublish(bundleDir, o); });

program.parseAsync(process.argv);
