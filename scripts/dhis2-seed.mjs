// Downloads the DHIS2 Sierra Leone demo DB dump (once) to ./.dhis2-seed/dump.sql.gz,
// which the dhis2-db compose service loads on first init.
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const URL = 'https://databases.dhis2.org/sierra-leone/2.40.3/dhis2-db-sierra-leone.sql.gz';
const dir = '.dhis2-seed';
const out = `${dir}/dump.sql.gz`;
if (existsSync(out)) { console.log(`[dhis2] seed already present at ${out}`); process.exit(0); }
mkdirSync(dir, { recursive: true });
console.log(`[dhis2] downloading ${URL} ...`);
const res = await fetch(URL);
if (!res.ok || !res.body) { console.error(`[dhis2] download failed: ${res.status}`); process.exit(1); }
await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
console.log(`[dhis2] seed written to ${out}`);
