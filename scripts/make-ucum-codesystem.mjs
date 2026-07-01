// Build a license-safe, bundled FHIR CodeSystem from the official UCUM distribution.
//
// UCUM (the Unified Code for Units of Measure) is © Regenstrief Institute, Inc. and
// the UCUM Organization. It is freely redistributable WITH ATTRIBUTION under the
// UCUM copyright/terms-of-use (see https://ucum.org/trac and the license shipped in
// the ucum-org/ucum repository). This script sources the canonical `ucum-essence.xml`
// and emits a FHIR R4 CodeSystem (url http://unitsofmeasure.org, content:'complete')
// whose concepts are the UCUM unit codes + display names — nothing else — so a fresh
// OpenLDR CE install ships full UCUM for coded-field authoring without a license gate.
//
// Usage:
//   node scripts/make-ucum-codesystem.mjs [path-to-ucum-essence.xml]
//
// With no argument, it fetches ucum-essence.xml from the UCUM project's public
// distribution. Output: packages/db/fixtures/fhir/ucum.codesystem.json.gz (gzipped).
//
// Reproducible build/dev artifact — committed alongside the gzipped fixture it produces.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UCUM_ESSENCE_URL = 'https://raw.githubusercontent.com/ucum-org/ucum/main/ucum-essence.xml';
const UCUM_SYSTEM_URL = 'http://unitsofmeasure.org';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'packages', 'db', 'fixtures', 'fhir');
const outFile = join(outDir, 'ucum.codesystem.json.gz');

/** Decode the handful of XML entities that appear inside UCUM name/printSymbol text. */
function decodeEntities(s) {
  return s
    .replace(/<sup>(.*?)<\/sup>/gs, '$1')
    .replace(/<[^>]+>/g, '') // strip any residual inline markup (e.g. <r>, <i>)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#215;/g, '×')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the first `<tag>...</tag>` inner text out of an element body, entity-decoded. */
function innerText(body, tag) {
  const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]) : null;
}

/** Read the value of an attribute from an element's open tag. */
function attr(openTag, name) {
  const m = openTag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Parse UCUM <prefix>, <base-unit> and <unit> elements into { code, display }.
 *
 * ucum-essence.xml enumerates the *atomic* building blocks of UCUM: 7 base units,
 * ~305 derived/special units, and ~24 metric prefixes. UCUM is a grammar, so
 * composed codes (mg, mL, mmol/L, 10*9/L …) are prefix×unit×exponent combinations
 * and are NOT individually listed here — they are validated by the grammar, and the
 * common lab-composed units also ship via migration 017's `cs-ucum-seed`. This bundle
 * therefore adds the full atomic catalog under the same http://unitsofmeasure.org url. */
function parseUcumConcepts(xml) {
  const concepts = [];
  const seen = new Set();
  const push = (openTag, body) => {
    // The case-SENSITIVE `Code` attribute is the canonical UCUM/FHIR code
    // (e.g. "g", "L", "10*"). `CODE` is the case-insensitive ASCII variant.
    const code = attr(openTag, 'Code');
    if (!code || seen.has(code)) return;
    const name = innerText(body, 'name');
    const printSymbol = innerText(body, 'printSymbol');
    const display = name || printSymbol || code;
    seen.add(code);
    concepts.push({ code, display });
  };
  // Units FIRST so that when a code is both a prefix and a unit (P, T, G, h, d, m,
  // u, a — e.g. "m" = milli-prefix and meter, "h" = hecto and hour), the UNIT wins:
  // atomic units are what coded-field authoring actually references.
  // base units
  for (const m of xml.matchAll(/<base-unit\b([^>]*)>([\s\S]*?)<\/base-unit>/g)) {
    push(m[1], m[2]);
  }
  // derived / special units
  for (const m of xml.matchAll(/<unit\b([^>]*)>([\s\S]*?)<\/unit>/g)) {
    push(m[1], m[2]);
  }
  // metric prefixes (Y, Z, E, …) — only the non-colliding ones are added.
  for (const m of xml.matchAll(/<prefix\b([^>]*)>([\s\S]*?)<\/prefix>/g)) {
    push(m[1], m[2]);
  }
  return concepts;
}

async function loadXml() {
  const argPath = process.argv[2];
  if (argPath) {
    console.log(`[ucum] reading local ${argPath}`);
    return readFileSync(argPath, 'utf8');
  }
  console.log(`[ucum] fetching ${UCUM_ESSENCE_URL}`);
  const res = await fetch(UCUM_ESSENCE_URL);
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${UCUM_ESSENCE_URL}`);
  return await res.text();
}

async function main() {
  const xml = await loadXml();
  const rootOpen = xml.match(/<root\b[^>]*>/)?.[0] ?? '';
  const version = attr(rootOpen, 'version') ?? 'unknown';
  const revisionDate = attr(rootOpen, 'revision-date');

  const concept = parseUcumConcepts(xml);
  if (concept.length < 100) {
    throw new Error(`implausibly few UCUM concepts parsed (${concept.length}) — aborting`);
  }

  const codeSystem = {
    resourceType: 'CodeSystem',
    id: 'ucum',
    url: UCUM_SYSTEM_URL,
    version,
    name: 'UCUM',
    title: 'Unified Code for Units of Measure',
    status: 'active',
    experimental: false,
    publisher: 'Regenstrief Institute, Inc. and the UCUM Organization',
    copyright:
      'UCUM is © Regenstrief Institute, Inc. and the UCUM Organization. ' +
      'Freely redistributable with attribution under the UCUM copyright/terms-of-use (https://ucum.org).',
    caseSensitive: true,
    content: 'complete',
    count: concept.length,
    concept,
  };

  mkdirSync(outDir, { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(codeSystem), 'utf8'), { level: 9 });
  writeFileSync(outFile, gz);

  console.log(`[ucum] UCUM version ${version} (revision-date ${revisionDate ?? 'n/a'})`);
  console.log(`[ucum] parsed ${concept.length} concepts`);
  console.log(`[ucum] wrote ${outFile} (${gz.length} bytes gzipped)`);
}

main().catch((err) => {
  console.error(`[ucum] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
