import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import { exitCodeFor, formatHealthTable } from './format';
import { runFhirValidate, formatFhirValidate } from './fhir';
import { runDbMigrate, runDbReset, runDbSeed } from './db';
import { runFormsExtract } from './forms';
import { runIngest, runPipelineStatus, runPipelineRetry, runPipelineLogs, runQueueStatus, runProvenanceAudit } from './ingest';
import { runPluginInstall, runPluginList, runPluginTest, runPluginRun, runPluginRemove } from './plugin';
import { runReportList, runReportRun } from './report';
import { runAuditList } from './audit';
import { runUserList, runUserShow, runUserCreate, runUserSetRole, runUserSetStatus } from './user';
import { runExport } from './export';
import { runTargetStoreTest } from './target-store';

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
        process.stdout.write(JSON.stringify({ status: 'down', error: errorMessage(err) }) + '\n');
      } else {
        process.stderr.write(`health failed: ${errorMessage(err)}\n`);
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
        process.stdout.write(JSON.stringify({ error: errorMessage(err) }) + '\n');
      } else {
        process.stderr.write(`fhir validate failed: ${errorMessage(err)}\n`);
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
      process.stderr.write(`db migrate failed: ${errorMessage(err)}\n`);
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
      process.stderr.write(`db reset failed: ${errorMessage(err)}\n`);
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
      process.stderr.write(`db seed failed: ${errorMessage(err)}\n`);
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
      process.stderr.write(`forms extract failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('ingest <file>')
  .description('Ingest a payload through the pipeline (accept + drain)')
  .option('--source <s>', 'source system identifier', 'cli')
  .option('--converter <id>', 'converter id', 'fhir-bundle')
  .option('--plugin <id>', 'plugin/converter id (alias of --converter)')
  .option('--json', 'emit JSON', false)
  .action(async (file: string, opts: { source: string; converter: string; plugin?: string; json: boolean }) => {
    if (opts.plugin) opts.converter = opts.plugin;
    try {
      process.exitCode = await runIngest(file, opts);
    } catch (err) {
      process.stderr.write(`ingest failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });

const pipeline = program.command('pipeline').description('Inspect the ingest pipeline');
pipeline.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineStatus(opts); } catch (err) { process.stderr.write(`pipeline status failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
pipeline.command('retry <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineRetry(batchId, opts); } catch (err) { process.stderr.write(`pipeline retry failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
pipeline.command('logs <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineLogs(batchId, opts); } catch (err) { process.stderr.write(`pipeline logs failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});

const queue = program.command('queue').description('Inspect the event queue');
queue.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runQueueStatus(opts); } catch (err) { process.stderr.write(`queue status failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});

const provenance = program.command('provenance').description('Provenance tooling');
provenance.command('audit').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runProvenanceAudit(opts); } catch (err) { process.stderr.write(`provenance audit failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});

const plugin = program.command('plugin').description('Manage WASM ingest plugins');
plugin
  .command('install <wasm>')
  .description('Install a plugin (.wasm + manifest.json) into blob + registry')
  .option('--manifest <path>', 'manifest path (default: manifest.json next to the wasm)')
  .option('--json', 'emit JSON', false)
  .action(async (wasm: string, opts: { manifest?: string; json: boolean }) => {
    try { process.exitCode = await runPluginInstall(wasm, opts); } catch (err) { process.stderr.write(`plugin install failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('list')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { json: boolean }) => {
    try { process.exitCode = await runPluginList(opts); } catch (err) { process.stderr.write(`plugin list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('test <id>')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginTest(id, opts); } catch (err) { process.stderr.write(`plugin test failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('run <input>')
  .description('Convert a local input file through a plugin (no queue)')
  .requiredOption('--plugin <id>', 'plugin id')
  .option('--version <v>', 'specific version')
  .option('--json', 'emit JSON', false)
  .action(async (input: string, opts: { plugin: string; version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRun(input, opts); } catch (err) { process.stderr.write(`plugin run failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
plugin
  .command('remove <id>')
  .option('--version <v>', 'specific version (default: all)')
  .option('--json', 'emit JSON', false)
  .action(async (id: string, opts: { version?: string; json: boolean }) => {
    try { process.exitCode = await runPluginRemove(id, opts); } catch (err) { process.stderr.write(`plugin remove failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });

const report = program.command('report').description('Domain reports over the analytics DB');
report.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportList(opts); } catch (err) { process.stderr.write(`report list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
report
  .command('run <id>')
  .option('--param <kv...>', 'parameter as key=value (repeatable)')
  .option('--json', 'emit JSON', false)
  .option('--csv', 'emit CSV', false)
  .action(async (id: string, opts: { param?: string[]; json: boolean; csv: boolean }) => {
    try { process.exitCode = await runReportRun(id, opts); } catch (err) { process.stderr.write(`report run failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });

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
    try { process.exitCode = await runAuditList(opts); } catch (err) { process.stderr.write(`audit list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });

const user = program.command('user').description('Local user management (decoupled from the IdP)');
user.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runUserList(opts); } catch (err) { process.stderr.write(`user list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('show <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserShow(id, opts); } catch (err) { process.stderr.write(`user show failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user
  .command('create')
  .requiredOption('--username <u>', 'username (unique)')
  .option('--name <n>', 'display name')
  .option('--email <e>', 'email')
  .option('--role <r...>', 'role (repeatable)')
  .option('--json', 'emit JSON', false)
  .action(async (opts: { username: string; name?: string; email?: string; role?: string[]; json: boolean }) => {
    try { process.exitCode = await runUserCreate(opts); } catch (err) { process.stderr.write(`user create failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
user.command('set-role <id> <roles...>').option('--json', 'emit JSON', false).action(async (id: string, roles: string[], opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetRole(id, roles, opts); } catch (err) { process.stderr.write(`user set-role failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('activate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'active', opts); } catch (err) { process.stderr.write(`user activate failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
user.command('deactivate <id>').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
  try { process.exitCode = await runUserSetStatus(id, 'disabled', opts); } catch (err) { process.stderr.write(`user deactivate failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
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
      process.stderr.write(`export failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
