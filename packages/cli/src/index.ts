import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import { exitCodeFor, formatHealthTable } from './format';
import { runFhirValidate, formatFhirValidate } from './fhir';

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

program.parseAsync(process.argv);
