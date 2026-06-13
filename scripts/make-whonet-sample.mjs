// Generates a synthetic WHONET SQLite sample using Node's built-in node:sqlite
// (no native build step). Node >= 22.5 required.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'whonet-sample.sqlite');

const db = new DatabaseSync(path);
db.exec(`
  DROP TABLE IF EXISTS isolates;
  CREATE TABLE isolates (
    patient_id TEXT, sex TEXT, birth_date TEXT,
    spec_num TEXT, spec_type TEXT, spec_date TEXT,
    organism TEXT, organism_code TEXT,
    ab_AMP TEXT, ab_CIP TEXT, ab_GEN TEXT
  );
`);
const insert = db.prepare('INSERT INTO isolates VALUES (?,?,?,?,?,?,?,?,?,?,?)');
insert.run('P001', 'F', '1990-04-12', 'S001', 'BLOOD', '2026-01-10', 'Escherichia coli', 'eco', 'R', 'S', 'S');
insert.run('P002', 'M', '1985-11-30', 'S002', 'URINE', '2026-01-11', 'Klebsiella pneumoniae', 'kpn', 'R', 'I', 'S');
db.close();
process.stdout.write(`wrote ${path}\n`);
