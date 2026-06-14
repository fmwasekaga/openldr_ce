// Generates a synthetic WHONET SQLite sample using Node's built-in node:sqlite
// (no native build step). Node >= 22.5 required.
// Usage: node scripts/make-whonet-sample.mjs [--rows N]   (default N=2).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const rowsArg = process.argv.indexOf('--rows');
const ROWS = rowsArg >= 0 ? Math.max(1, parseInt(process.argv[rowsArg + 1], 10) || 2) : 2;

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'whonet-sample.sqlite');

const db = new DatabaseSync(path);
db.exec(`
  DROP TABLE IF EXISTS isolates;
  CREATE TABLE isolates (
    patient_id TEXT, sex TEXT, birth_date TEXT,
    spec_num TEXT, spec_type TEXT, spec_date TEXT,
    organism TEXT, organism_code TEXT, location_type TEXT,
    ab_AMP TEXT, ab_CIP TEXT, ab_GEN TEXT
  );
`);
const insert = db.prepare('INSERT INTO isolates VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');

// Deterministic generator (no Math.random) so runs are reproducible.
const SEX = ['F', 'M'];
const SPEC = ['BLOOD', 'URINE', 'WOUND', 'CSF'];
const ORG = [
  ['Escherichia coli', 'eco'],
  ['Klebsiella pneumoniae', 'kpn'],
  ['Staphylococcus aureus', 'sau'],
  ['Pseudomonas aeruginosa', 'pae'],
];
const LOC = ['i', 'o'];
const SIR = ['R', 'I', 'S'];
const pad = (n) => String(n).padStart(4, '0');
const day = (n) => String((n % 27) + 1).padStart(2, '0');
const mon = (n) => String((n % 12) + 1).padStart(2, '0');
for (let i = 0; i < ROWS; i++) {
  const [org, code] = ORG[i % ORG.length];
  insert.run(
    `P${pad(i + 1)}`,
    SEX[i % 2],
    `19${70 + (i % 30)}-${mon(i)}-${day(i)}`,
    `S${pad(i + 1)}`,
    SPEC[i % SPEC.length],
    `2026-01-${day(i)}`,
    org,
    code,
    LOC[i % 2],
    SIR[i % 3],
    SIR[(i + 1) % 3],
    SIR[(i + 2) % 3],
  );
}
db.close();
process.stdout.write(`wrote ${path} (${ROWS} rows)\n`);
