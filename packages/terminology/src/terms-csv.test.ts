import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseTerminologyTerms, parseTerminologyTermsStream, parseTermsCsv, terminologyImportTemplate } from './terms-csv';

describe('parseTermsCsv', () => {
  it('parses code/display/shortName/class/unit/status into concept rows', () => {
    const csv = 'code,display,shortName,class,unit,status\nAMP,Ampicillin,Amp,ABX,,ACTIVE\nCIP,Ciprofloxacin,,ABX,mg,DRAFT\n';
    const rows = parseTermsCsv(csv, 'http://x');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE' });
    expect(rows[0].properties).toMatchObject({ shortName: 'Amp', class: 'ABX' });
    expect(rows[1].properties).toMatchObject({ class: 'ABX', unit: 'mg' });
  });
  it('skips rows with a blank code and defaults status to ACTIVE', () => {
    const rows = parseTermsCsv('code,display,status\n,nope,\nGEN,Gentamicin,\n', 'http://x');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'GEN', status: 'ACTIVE' });
  });
  it('exposes a header-only template', () => {
    expect(terminologyImportTemplate('CUSTOM').body).toContain('"code"');
  });
});

describe('parseTerminologyTerms', () => {
  it('maps official LOINC CSV rows into concept rows', () => {
    const rows = parseTerminologyTerms([
      'LOINC_NUM,COMPONENT,PROPERTY,TIME_ASPCT,SYSTEM,SCALE_TYP,METHOD_TYP,CLASS,STATUS,LONG_COMMON_NAME,SHORTNAME,EXAMPLE_UCUM_UNITS',
      '"718-7","Hemoglobin","MCnc","Pt","Bld","Qn","","HEM/BC","ACTIVE","Hemoglobin [Mass/volume] in Blood","Hgb Bld-mCnc","g/dL"',
    ].join('\n'), 'http://loinc.org', 'LOINC');

    expect(rows).toEqual([
      {
        system: 'http://loinc.org',
        code: '718-7',
        display: 'Hemoglobin [Mass/volume] in Blood',
        status: 'ACTIVE',
        properties: {
          shortName: 'Hgb Bld-mCnc',
          class: 'HEM/BC',
          unit: 'g/dL',
          metadata: {
            component: 'Hemoglobin',
            property: 'MCnc',
            timeAspect: 'Pt',
            loincSystem: 'Bld',
            scaleType: 'Qn',
            methodType: null,
          },
        },
      },
    ]);
  });

  it('deduplicates SNOMED RF2 descriptions by concept and prefers active synonyms', () => {
    const rows = parseTerminologyTerms([
      'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
      'd1\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000003001\tBlood specimen (specimen)\t900000000000448009',
      'd2\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009',
      'd3\t20250131\t0\t900000000000207008\t122575003\ten\t900000000000013009\tUrine specimen\t900000000000448009',
    ].join('\n'), 'http://snomed.info/sct', 'SNOMEDCT');

    expect(rows).toEqual([
      {
        system: 'http://snomed.info/sct',
        code: '119297000',
        display: 'Blood specimen',
        status: 'ACTIVE',
        properties: {
          class: 'SNOMED CT',
          metadata: {
            descriptionId: 'd2',
            effectiveTime: '20250131',
            languageCode: 'en',
            typeId: '900000000000013009',
          },
        },
      },
    ]);
  });

  it('accepts legacy SCT as a SNOMED RF2 system code', () => {
    const rows = parseTerminologyTerms([
      'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
      'd2\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009',
    ].join('\n'), 'http://snomed.info/sct', 'SCT');

    expect(rows).toEqual([
      expect.objectContaining({
        system: 'http://snomed.info/sct',
        code: '119297000',
        display: 'Blood specimen',
      }),
    ]);
  });

  it('maps active English RXNORM rows from RXNCONSO.RRF', () => {
    const rows = parseTerminologyTerms([
      '1049630|ENG||L0001||S0001|Y|A1||||RXNORM|SCD|1049630|Amoxicillin 500 MG Oral Capsule|0|N|4096|',
      '1049630|SPA||L0002||S0002|Y|A2||||RXNORM|SCD|1049630|Spanish label|0|N|4096|',
      '999|ENG||L0003||S0003|N|A3||||RXNORM|IN|999|Suppressed thing|0|Y||',
    ].join('\n'), 'http://www.nlm.nih.gov/research/umls/rxnorm', 'RxNorm');

    expect(rows).toEqual([
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '1049630',
        display: 'Amoxicillin 500 MG Oral Capsule',
        status: 'ACTIVE',
        properties: {
          class: 'SCD',
          metadata: {
            source: 'RXNORM',
            tty: 'SCD',
            sourceCode: '1049630',
            atomId: 'A1',
          },
        },
      },
    ]);
  });

  it('parses generic JSONL and ignores comments plus meta headers', () => {
    const rows = parseTerminologyTerms([
      '// comment',
      '{"type":"meta","codingSystem":"UCUM","version":"2026-01-01"}',
      '{"code":"mg/dL","displayName":"milligram per deciliter","class":"mass concentration","metadata":{"ucum":true}}',
      '{"code":"B20","display_name":"HIV disease","status":"DRAFT"}',
    ].join('\n'), 'http://unitsofmeasure.org', 'UCUM');

    expect(rows).toEqual([
      {
        system: 'http://unitsofmeasure.org',
        code: 'mg/dL',
        display: 'milligram per deciliter',
        status: 'ACTIVE',
        properties: { class: 'mass concentration', metadata: { ucum: true } },
      },
      {
        system: 'http://unitsofmeasure.org',
        code: 'B20',
        display: 'HIV disease',
        status: 'DRAFT',
        properties: null,
      },
    ]);
  });

  it('returns a system-specific template', () => {
    expect(terminologyImportTemplate('LOINC')).toMatchObject({ filename: 'loinc-import-template.csv', contentType: 'text/csv' });
    expect(terminologyImportTemplate('SNOMEDCT').body).toContain('conceptId');
    expect(terminologyImportTemplate('SCT').filename).toBe('snomed-rf2-description-template.txt');
    expect(terminologyImportTemplate('RxNorm').filename).toBe('RXNCONSO-template.RRF');
    expect(terminologyImportTemplate('ICD-10').filename).toBe('terminology-import-template.jsonl');
  });
});

describe('parseTerminologyTermsStream', () => {
  it('streams SNOMED RF2 description rows without requiring a JSON request body', async () => {
    const rows = await parseTerminologyTermsStream(Readable.from([
      'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId\n',
      'd1\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000003001\tBlood specimen (specimen)\t900000000000448009\n',
      'd2\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009\n',
    ]), 'http://snomed.info/sct', 'SNOMED-CT');

    expect(rows).toEqual([
      expect.objectContaining({
        system: 'http://snomed.info/sct',
        code: '119297000',
        display: 'Blood specimen',
      }),
    ]);
  });
});
