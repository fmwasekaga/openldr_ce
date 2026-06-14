// Writes samples/lab-sample.csv and samples/lab-sample.xlsx for the tabular plugin.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });

const headers = ['PatientID', 'Sex', 'DOB', 'SpecimenNo', 'Specimen', 'CollectionDate', 'LocationType', 'Organism', 'OrganismCode', 'AMP', 'CIP', 'GEN'];
const rows = [
  ['T001', 'F', '1990-04-12', 'TS001', 'BLOOD', '2026-01-10', 'I', 'Escherichia coli', 'eco', 'R', 'S', 'S'],
  ['T002', 'M', '1985-11-30', 'TS002', 'URINE', '2026-01-11', 'O', 'Klebsiella pneumoniae', 'kpn', 'R', 'I', 'S'],
];

const csv = [headers, ...rows].map((r) => r.join(',')).join('\n') + '\n';
writeFileSync(join(dir, 'lab-sample.csv'), csv);

const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
XLSX.writeFile(wb, join(dir, 'lab-sample.xlsx'));
process.stdout.write('wrote samples/lab-sample.csv + lab-sample.xlsx\n');
