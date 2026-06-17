import { createInterface } from 'node:readline';
import { parse as parseCsvStream } from 'csv-parse';
import { parse as parseCsvSync } from 'csv-parse/sync';
import type { ConceptRecord } from '@openldr/db';

export const TERMS_CSV_TEMPLATE = 'code,display,shortName,class,unit,status\n';
const SNOMED_FSN_TYPE = '900000000000003001';
const SNOMED_SYNONYM_TYPE = '900000000000013009';

interface ParsedTerm {
  code: string;
  display: string | null;
  shortName: string | null;
  class: string | null;
  unit: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
}

export interface TerminologyImportTemplate {
  filename: string;
  contentType: string;
  body: string;
}

/** Parse a terms CSV (code,display,shortName,class,unit,status) into ConceptRecord[]
 *  for one coding system. Blank-code rows are skipped; extra columns go to properties. */
export function parseTermsCsv(csv: string, systemUrl: string): ConceptRecord[] {
  const records = parseCsvSync(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return records
    .filter((r) => (r.code ?? '').trim())
    .map((r) => {
      const props: Record<string, unknown> = {};
      if (r.shortName) props.shortName = r.shortName;
      if (r.class) props.class = r.class;
      if (r.unit) props.unit = r.unit;
      return {
        system: systemUrl,
        code: r.code.trim(),
        display: r.display?.trim() || null,
        status: r.status?.trim() || 'ACTIVE',
        properties: Object.keys(props).length ? props : null,
      };
    });
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function termStatus(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'DEPRECATED' || normalized === 'DISABLED' || normalized === 'DRAFT'
    ? normalized
    : 'ACTIVE';
}

function headerMap(header: string[], normalize = (s: string): string => s.trim().toUpperCase()): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((name, i) => map.set(normalize(name), i));
  return map;
}

function value(row: string[], headers: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const index = headers.get(name);
    if (index !== undefined) return row[index]?.trim() ?? '';
  }
  return '';
}

function packTerm(systemUrl: string, term: ParsedTerm): ConceptRecord {
  const props: Record<string, unknown> = {};
  if (term.shortName) props.shortName = term.shortName;
  if (term.class) props.class = term.class;
  if (term.unit) props.unit = term.unit;
  if (term.metadata) props.metadata = term.metadata;
  return {
    system: systemUrl,
    code: term.code,
    display: term.display,
    status: term.status,
    properties: Object.keys(props).length ? props : null,
  };
}

function compactSystemCode(systemCode: string | null | undefined): string {
  return systemCode?.trim().toUpperCase().replace(/[\s_-]/g, '') ?? '';
}

function isSnomedSystemCode(systemCode: string | null | undefined): boolean {
  const compact = compactSystemCode(systemCode);
  return compact === 'SNOMEDCT' || compact === 'SNOMED' || compact === 'SCT';
}

function parseLoincCsvTerms(text: string): ParsedTerm[] {
  const records = parseCsvSync(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return records
    .filter((r) => (r.LOINC_NUM ?? '').trim() && (r.LONG_COMMON_NAME ?? '').trim())
    .map((r) => ({
      code: r.LOINC_NUM.trim(),
      display: r.LONG_COMMON_NAME.trim(),
      shortName: emptyToNull(r.SHORTNAME ?? r.SHORT_NAME),
      class: emptyToNull(r.CLASS),
      unit: emptyToNull(r.EXAMPLE_UCUM_UNITS ?? r.UNITSREQUIRED),
      status: termStatus(r.STATUS),
      metadata: {
        component: emptyToNull(r.COMPONENT),
        property: emptyToNull(r.PROPERTY),
        timeAspect: emptyToNull(r.TIME_ASPCT ?? r.TIME_ASPECT),
        loincSystem: emptyToNull(r.SYSTEM),
        scaleType: emptyToNull(r.SCALE_TYP ?? r.SCALE_TYPE),
        methodType: emptyToNull(r.METHOD_TYP ?? r.METHOD_TYPE),
      },
    }));
}

function loincRecordToTerm(r: Record<string, string>): ParsedTerm | null {
  if (!(r.LOINC_NUM ?? '').trim() || !(r.LONG_COMMON_NAME ?? '').trim()) return null;
  return {
    code: r.LOINC_NUM.trim(),
    display: r.LONG_COMMON_NAME.trim(),
    shortName: emptyToNull(r.SHORTNAME ?? r.SHORT_NAME),
    class: emptyToNull(r.CLASS),
    unit: emptyToNull(r.EXAMPLE_UCUM_UNITS ?? r.UNITSREQUIRED),
    status: termStatus(r.STATUS),
    metadata: {
      component: emptyToNull(r.COMPONENT),
      property: emptyToNull(r.PROPERTY),
      timeAspect: emptyToNull(r.TIME_ASPCT ?? r.TIME_ASPECT),
      loincSystem: emptyToNull(r.SYSTEM),
      scaleType: emptyToNull(r.SCALE_TYP ?? r.SCALE_TYPE),
      methodType: emptyToNull(r.METHOD_TYP ?? r.METHOD_TYPE),
    },
  };
}

function parseSnomedRf2DescriptionTerms(text: string): ParsedTerm[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = headerMap(lines[0]!.split('\t'), (s) => s.trim());
  const byConcept = new Map<string, ParsedTerm & { preference: number }>();
  for (const line of lines.slice(1)) {
    const row = line.split('\t');
    if (value(row, headers, 'active') !== '1') continue;
    const conceptId = value(row, headers, 'conceptId');
    const term = value(row, headers, 'term');
    if (!conceptId || !term) continue;
    const typeId = value(row, headers, 'typeId');
    const preference = typeId === SNOMED_SYNONYM_TYPE ? 2 : typeId === SNOMED_FSN_TYPE ? 1 : 0;
    const current = byConcept.get(conceptId);
    if (current && current.preference > preference) continue;
    byConcept.set(conceptId, {
      code: conceptId,
      display: term,
      shortName: null,
      class: 'SNOMED CT',
      unit: null,
      status: 'ACTIVE',
      metadata: {
        descriptionId: emptyToNull(value(row, headers, 'id')),
        effectiveTime: emptyToNull(value(row, headers, 'effectiveTime')),
        languageCode: emptyToNull(value(row, headers, 'languageCode')),
        typeId: emptyToNull(typeId),
      },
      preference,
    });
  }
  return [...byConcept.values()].map(({ preference: _preference, ...term }) => term);
}

function snomedDescriptionTerm(
  row: string[],
  headers: Map<string, number>,
): (ParsedTerm & { preference: number }) | null {
  if (value(row, headers, 'active') !== '1') return null;
  const conceptId = value(row, headers, 'conceptId');
  const term = value(row, headers, 'term');
  if (!conceptId || !term) return null;
  const typeId = value(row, headers, 'typeId');
  const preference = typeId === SNOMED_SYNONYM_TYPE ? 2 : typeId === SNOMED_FSN_TYPE ? 1 : 0;
  return {
    code: conceptId,
    display: term,
    shortName: null,
    class: 'SNOMED CT',
    unit: null,
    status: 'ACTIVE',
    metadata: {
      descriptionId: emptyToNull(value(row, headers, 'id')),
      effectiveTime: emptyToNull(value(row, headers, 'effectiveTime')),
      languageCode: emptyToNull(value(row, headers, 'languageCode')),
      typeId: emptyToNull(typeId),
    },
    preference,
  };
}

function parseRxNormConsoTerms(text: string): ParsedTerm[] {
  const byRxCui = new Map<string, ParsedTerm & { preference: number }>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = line.split('|');
    const rxcui = row[0]?.trim() ?? '';
    const lat = row[1]?.trim() ?? '';
    const isPref = row[6]?.trim() ?? '';
    const atomId = row[7]?.trim() ?? '';
    const source = row[11]?.trim() ?? '';
    const tty = row[12]?.trim() ?? '';
    const sourceCode = row[13]?.trim() ?? '';
    const display = row[14]?.trim() ?? '';
    const suppress = row[16]?.trim() ?? '';
    if (!rxcui || !display || lat !== 'ENG' || suppress !== 'N' || source !== 'RXNORM') continue;
    const preference = isPref === 'Y' ? 2 : 1;
    const current = byRxCui.get(rxcui);
    if (current && current.preference > preference) continue;
    byRxCui.set(rxcui, {
      code: rxcui,
      display,
      shortName: null,
      class: emptyToNull(tty),
      unit: null,
      status: 'ACTIVE',
      metadata: {
        source,
        tty: emptyToNull(tty),
        sourceCode: emptyToNull(sourceCode),
        atomId: emptyToNull(atomId),
      },
      preference,
    });
  }
  return [...byRxCui.values()].map(({ preference: _preference, ...term }) => term);
}

function rxNormConsoTerm(line: string): (ParsedTerm & { preference: number }) | null {
  const row = line.split('|');
  const rxcui = row[0]?.trim() ?? '';
  const lat = row[1]?.trim() ?? '';
  const isPref = row[6]?.trim() ?? '';
  const atomId = row[7]?.trim() ?? '';
  const source = row[11]?.trim() ?? '';
  const tty = row[12]?.trim() ?? '';
  const sourceCode = row[13]?.trim() ?? '';
  const display = row[14]?.trim() ?? '';
  const suppress = row[16]?.trim() ?? '';
  if (!rxcui || !display || lat !== 'ENG' || suppress !== 'N' || source !== 'RXNORM') return null;
  return {
    code: rxcui,
    display,
    shortName: null,
    class: emptyToNull(tty),
    unit: null,
    status: 'ACTIVE',
    metadata: {
      source,
      tty: emptyToNull(tty),
      sourceCode: emptyToNull(sourceCode),
      atomId: emptyToNull(atomId),
    },
    preference: isPref === 'Y' ? 2 : 1,
  };
}

function parseJsonlTerms(text: string): ParsedTerm[] {
  const rows: ParsedTerm[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('//')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`line ${i + 1}: Invalid JSON`);
    }
    if (obj.type === 'meta') continue;
    const code = typeof obj.code === 'string' ? obj.code.trim() : '';
    const display = typeof obj.displayName === 'string'
      ? obj.displayName.trim()
      : typeof obj.display_name === 'string'
        ? obj.display_name.trim()
        : typeof obj.display === 'string'
          ? obj.display.trim()
          : '';
    if (!code) throw new Error(`line ${i + 1}: code required`);
    if (!display) throw new Error(`line ${i + 1}: displayName required`);
    const metadata = obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)
      ? obj.metadata as Record<string, unknown>
      : null;
    rows.push({
      code,
      display,
      shortName: typeof obj.shortName === 'string' ? obj.shortName : typeof obj.short_name === 'string' ? obj.short_name : null,
      class: typeof obj.class === 'string' ? obj.class : null,
      unit: typeof obj.unit === 'string' ? obj.unit : null,
      status: typeof obj.status === 'string' ? termStatus(obj.status) : 'ACTIVE',
      metadata,
    });
  }
  return rows;
}

function parseJsonlLine(line: string, lineNumber: number): ParsedTerm | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(`line ${lineNumber}: Invalid JSON`);
  }
  if (obj.type === 'meta') return null;
  const code = typeof obj.code === 'string' ? obj.code.trim() : '';
  const display = typeof obj.displayName === 'string'
    ? obj.displayName.trim()
    : typeof obj.display_name === 'string'
      ? obj.display_name.trim()
      : typeof obj.display === 'string'
        ? obj.display.trim()
        : '';
  if (!code) throw new Error(`line ${lineNumber}: code required`);
  if (!display) throw new Error(`line ${lineNumber}: displayName required`);
  const metadata = obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)
    ? obj.metadata as Record<string, unknown>
    : null;
  return {
    code,
    display,
    shortName: typeof obj.shortName === 'string' ? obj.shortName : typeof obj.short_name === 'string' ? obj.short_name : null,
    class: typeof obj.class === 'string' ? obj.class : null,
    unit: typeof obj.unit === 'string' ? obj.unit : null,
    status: typeof obj.status === 'string' ? termStatus(obj.status) : 'ACTIVE',
    metadata,
  };
}

/** Parse the selected code-system's practical source format, falling back to generic JSONL/NDJSON. */
export function parseTerminologyTerms(text: string, systemUrl: string, systemCode: string): ConceptRecord[] {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const code = systemCode.trim().toUpperCase();
  let terms: ParsedTerm[];
  if (code === 'LOINC' && first.toUpperCase().includes('LOINC_NUM')) {
    terms = parseLoincCsvTerms(text);
  } else if (isSnomedSystemCode(code) && first.includes('conceptId') && first.includes('term')) {
    terms = parseSnomedRf2DescriptionTerms(text);
  } else if (code === 'RXNORM' && first.split('|').length >= 17) {
    terms = parseRxNormConsoTerms(text);
  } else if (first.includes('code,') && first.includes('display')) {
    return parseTermsCsv(text, systemUrl);
  } else {
    terms = parseJsonlTerms(text);
  }
  return terms.map((term) => packTerm(systemUrl, term));
}

async function* readLines(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) yield String(line);
}

async function parseLoincCsvTermsStream(input: NodeJS.ReadableStream): Promise<ParsedTerm[]> {
  const parser = input.pipe(parseCsvStream({ columns: true, skip_empty_lines: true, trim: true }));
  const terms: ParsedTerm[] = [];
  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    const term = loincRecordToTerm(record);
    if (term) terms.push(term);
  }
  return terms;
}

/** Parse terminology from a raw upload stream. This avoids browser/server JSON buffering for large source files. */
export async function parseTerminologyTermsStream(input: NodeJS.ReadableStream, systemUrl: string, systemCode: string): Promise<ConceptRecord[]> {
  const code = systemCode.trim().toUpperCase();
  let terms: ParsedTerm[];

  if (code === 'LOINC') {
    terms = await parseLoincCsvTermsStream(input);
  } else if (isSnomedSystemCode(code)) {
    const lines = readLines(input);
    const header = (await lines.next()).value;
    if (!header) return [];
    const headers = headerMap(String(header).split('\t'), (s) => s.trim());
    const byConcept = new Map<string, ParsedTerm & { preference: number }>();
    for await (const line of lines) {
      if (!line.trim()) continue;
      const term = snomedDescriptionTerm(line.split('\t'), headers);
      if (!term) continue;
      const current = byConcept.get(term.code);
      if (current && current.preference > term.preference) continue;
      byConcept.set(term.code, term);
    }
    terms = [...byConcept.values()].map(({ preference: _preference, ...term }) => term);
  } else if (code === 'RXNORM') {
    const byRxCui = new Map<string, ParsedTerm & { preference: number }>();
    for await (const line of readLines(input)) {
      if (!line.trim()) continue;
      const term = rxNormConsoTerm(line);
      if (!term) continue;
      const current = byRxCui.get(term.code);
      if (current && current.preference > term.preference) continue;
      byRxCui.set(term.code, term);
    }
    terms = [...byRxCui.values()].map(({ preference: _preference, ...term }) => term);
  } else {
    const lines = readLines(input);
    let first = '';
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      first = line;
      break;
    }
    if (first.includes('code,') && first.includes('display')) {
      let text = `${first}\n`;
      for await (const line of lines) text += `${line}\n`;
      return parseTermsCsv(text, systemUrl);
    }
    terms = [];
    if (first) {
      const firstTerm = parseJsonlLine(first, lineNumber);
      if (firstTerm) terms.push(firstTerm);
    }
    for await (const line of lines) {
      lineNumber += 1;
      const term = parseJsonlLine(line, lineNumber);
      if (term) terms.push(term);
    }
  }

  return terms.map((term) => packTerm(systemUrl, term));
}

export function terminologyImportTemplate(systemCode: string | null | undefined): TerminologyImportTemplate {
  const code = systemCode?.trim().toUpperCase();
  if (code === 'LOINC') {
    return {
      filename: 'loinc-import-template.csv',
      contentType: 'text/csv',
      body: [
        'LOINC_NUM,COMPONENT,PROPERTY,TIME_ASPCT,SYSTEM,SCALE_TYP,METHOD_TYP,CLASS,STATUS,LONG_COMMON_NAME,SHORTNAME,EXAMPLE_UCUM_UNITS',
        '"718-7","Hemoglobin","MCnc","Pt","Bld","Qn","","HEM/BC","ACTIVE","Hemoglobin [Mass/volume] in Blood","Hgb Bld-mCnc","g/dL"',
        '',
      ].join('\n'),
    };
  }
  if (isSnomedSystemCode(code)) {
    return {
      filename: 'snomed-rf2-description-template.txt',
      contentType: 'text/plain',
      body: [
        'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
        'd2\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009',
        '',
      ].join('\n'),
    };
  }
  if (code === 'RXNORM') {
    return {
      filename: 'RXNCONSO-template.RRF',
      contentType: 'text/plain',
      body: [
        '1049630|ENG||L0001||S0001|Y|A1||||RXNORM|SCD|1049630|Amoxicillin 500 MG Oral Capsule|0|N|4096|',
        '',
      ].join('\n'),
    };
  }
  return {
    filename: 'terminology-import-template.jsonl',
    contentType: 'application/x-ndjson',
    body: [
      '// Terminology import template. One JSON object per line.',
      '// Required: code, displayName. Optional: shortName, class, unit, status, metadata.',
      '// Blank lines and // comments are ignored.',
      JSON.stringify({ type: 'meta', codingSystem: systemCode ?? 'CUSTOM', version: '2026-01-01' }),
      JSON.stringify({ code: '119361006', displayName: 'Plasma specimen', shortName: 'Plasma', class: 'Specimen' }),
      JSON.stringify({ code: '441407007', displayName: 'HIV 1 RNA measurement', class: 'Procedure', unit: 'copies/mL', metadata: { equivalentLoinc: '20447-9' } }),
      '',
    ].join('\n'),
  };
}
