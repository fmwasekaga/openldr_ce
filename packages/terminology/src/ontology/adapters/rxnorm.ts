import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ConceptRecord } from '@openldr/db';
import { canonicalSystemUrl } from '../../system-urls';
import { ROOT_CODE, type ConceptSink, type DetectedDistribution, type FileStat, type IndexWriter, type OntologyAdapter } from '../types';

// RxNorm two-layer model. The browsable spine is the ATC classification tree
// (built from SAB=ATC atoms by code prefix); its level-5 leaves bridge to RxNorm
// ingredients. Each drug concept then expands into labeled relationship groups.
//
// Real RXNREL facts: rows read RXCUI2 <RELA> RXCUI1, normalized to
// src=RXCUI2 (field 4), dst=RXCUI1 (field 0); SAB at 10, RELA at 7.
//   IN  -ingredient_of-> SCDC   (NOT SCD)
//   SCDC-constitutes->   SCD
//   SCD -consists_of->   SCDC
//   SCDC-has_ingredient->IN
//   SCD -has_dose_form-> DF ; SCD -has_tradename-> SBD ; IN -has_tradename-> BN ;
//   SBD -tradename_of->  SCD
// So "Clinical drugs" (IN->SCD) and "Ingredients" (SCD->IN) are 2-hop through SCDC.

const SEMANTIC_TTYS = new Set([
  'IN',
  'MIN',
  'PIN',
  'DF',
  'DFG',
  'SCDC',
  'SCDF',
  'SCD',
  'SBDC',
  'SBDF',
  'SBD',
  'BN',
  'BPCK',
  'GPCK',
]);

const ATC_LEN_TO_LEVEL: Record<number, number> = { 1: 1, 3: 2, 4: 3, 5: 4, 7: 5 };

function atcParent(code: string): string | null {
  switch (code.length) {
    case 7:
      return code.slice(0, 5);
    case 5:
      return code.slice(0, 4);
    case 4:
      return code.slice(0, 3);
    case 3:
      return code.slice(0, 1);
    default:
      return null;
  }
}

async function streamPipe(path: string, onRow: (cols: string[]) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) onRow(line.split('|'));
  }
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

interface Concept {
  display: string;
  displayPrio: number;
  tty: string | null;
}

export const rxnormAdapter: OntologyAdapter = {
  type: 'rxnorm',

  detect(folderPath): DetectedDistribution | null {
    const conso = join(folderPath, 'rrf', 'RXNCONSO.RRF');
    const rel = join(folderPath, 'rrf', 'RXNREL.RRF');
    if (!existsSync(conso) || !existsSync(rel)) return null;
    const stats: FileStat[] = [conso, rel].map((path) => {
      const st = statSync(path);
      return { path, size: st.size, mtimeMs: st.mtimeMs };
    });
    return { type: 'rxnorm', folderPath, files: { conso, rel }, fileStats: stats };
  },

  async buildIndex(dist, writer: IndexWriter, onProgress, conceptSink?: ConceptSink): Promise<void> {
    const concepts = new Map<string, Concept>();
    const atcNames = new Map<string, string>();
    const atcLeafToIngredient = new Map<string, Set<string>>();

    // Pass 1: RXNORM semantic atoms + ATC atoms.
    // RXNCONSO: 0 RXCUI, 1 LAT, 6 ISPREF, 11 SAB, 12 TTY, 13 CODE, 14 STR, 16 SUPPRESS.
    onProgress({ phase: 'concepts', processed: 0, total: null });
    let cCount = 0;
    await streamPipe(dist.files['conso']!, (cols) => {
      const rxcui = cols[0] ?? '';
      const lat = cols[1] ?? '';
      const ispref = cols[6] ?? '';
      const sab = cols[11] ?? '';
      const tty = cols[12] ?? '';
      const code = cols[13] ?? '';
      const str = cols[14] ?? '';
      const sup = cols[16] ?? '';
      if (!rxcui || !str || lat !== 'ENG' || sup === 'O') return;
      if (sab === 'ATC' && code) {
        if (ATC_LEN_TO_LEVEL[code.length] && !atcNames.has(code)) atcNames.set(code, str);
        if (code.length === 7) add(atcLeafToIngredient, code, rxcui);
        return;
      }
      if (sab !== 'RXNORM') return;
      const semantic = SEMANTIC_TTYS.has(tty);
      const prio = semantic ? 3 : ispref === 'Y' ? 2 : 1;
      let cur = concepts.get(rxcui);
      if (!cur) {
        cur = { display: str, displayPrio: prio, tty: null };
        concepts.set(rxcui, cur);
      } else if (prio > cur.displayPrio) {
        cur.display = str;
        cur.displayPrio = prio;
      }
      if (semantic && !cur.tty) cur.tty = tty;
      if (++cCount % 100000 === 0) onProgress({ phase: 'concepts', processed: cCount, total: null });
    });

    if (conceptSink) {
      const url = canonicalSystemUrl('rxnorm')!;
      let batch: ConceptRecord[] = [];
      for (const [rxcui, concept] of concepts) {
        if (!concept.tty) continue; // semantic-TTY drug concepts only
        batch.push({ system: url, code: rxcui, display: concept.display, status: 'active', properties: { tty: concept.tty } });
        if (batch.length >= 1000) {
          await conceptSink(batch);
          batch = [];
        }
      }
      if (batch.length) await conceptSink(batch);
    }

    // Pass 2: capture the single-hop relations we compose into groups.
    // Normalized src = RXCUI2 (c[4]), dst = RXCUI1 (c[0]); SAB c[10], RELA c[7].
    const inToScdc = new Map<string, Set<string>>();
    const scdcToScd = new Map<string, Set<string>>();
    const scdToScdc = new Map<string, Set<string>>();
    const scdcToIn = new Map<string, Set<string>>();
    const directEdges: Array<{ src: string; dst: string; label: string }> = [];
    const directSeen = new Set<string>();
    const addDirect = (src: string, dst: string, label: string): void => {
      const key = `${src}>${dst}>${label}`;
      if (!directSeen.has(key)) {
        directSeen.add(key);
        directEdges.push({ src, dst, label });
      }
    };
    onProgress({ phase: 'relationships', processed: 0, total: null });
    let rCount = 0;
    await streamPipe(dist.files['rel']!, (cols) => {
      if ((cols[10] ?? '') !== 'RXNORM') return;
      const dst = cols[0] ?? '';
      const src = cols[4] ?? '';
      const rela = cols[7] ?? '';
      if (!src || !dst) return;
      const srcTty = concepts.get(src)?.tty;
      const dstTty = concepts.get(dst)?.tty;
      if (!srcTty || !dstTty) return;
      if (rela === 'ingredient_of' && srcTty === 'IN' && dstTty === 'SCDC') add(inToScdc, src, dst);
      else if (rela === 'constitutes' && srcTty === 'SCDC' && dstTty === 'SCD') add(scdcToScd, src, dst);
      else if (rela === 'consists_of' && srcTty === 'SCD' && dstTty === 'SCDC') add(scdToScdc, src, dst);
      else if (rela === 'has_ingredient' && srcTty === 'SCDC' && dstTty === 'IN') add(scdcToIn, src, dst);
      else if (rela === 'has_dose_form' && srcTty === 'SCD' && dstTty === 'DF') addDirect(src, dst, 'Dose form');
      else if (rela === 'has_tradename' && srcTty === 'SCD' && dstTty === 'SBD') addDirect(src, dst, 'Branded versions');
      else if (rela === 'has_tradename' && srcTty === 'IN' && dstTty === 'BN') addDirect(src, dst, 'Brand names');
      else if (rela === 'tradename_of' && srcTty === 'SBD' && dstTty === 'SCD') addDirect(src, dst, 'Generic equivalent');
      if (++rCount % 200000 === 0) onProgress({ phase: 'relationships', processed: rCount, total: null });
    });

    // Derive labeled grouped edges (2-hop for Clinical drugs and Ingredients).
    const labeled: Array<{ src: string; dst: string; label: string }> = [...directEdges];
    const labSeen = new Set(labeled.map((edge) => `${edge.src}>${edge.dst}>${edge.label}`));
    const addLab = (src: string, dst: string, label: string): void => {
      const key = `${src}>${dst}>${label}`;
      if (!labSeen.has(key)) {
        labSeen.add(key);
        labeled.push({ src, dst, label });
      }
    };
    for (const [inc, scdcs] of inToScdc) {
      for (const scdc of scdcs) {
        const scds = scdcToScd.get(scdc);
        if (scds) for (const scd of scds) addLab(inc, scd, 'Clinical drugs');
      }
    }
    for (const [scd, scdcs] of scdToScdc) {
      for (const scdc of scdcs) {
        addLab(scd, scdc, 'Strength components');
        const ins = scdcToIn.get(scdc);
        if (ins) for (const inc of ins) addLab(scd, inc, 'Ingredients');
      }
    }

    // Node set: ATC classes (+ derived ancestors), every IN, and every edge endpoint.
    const atcCodes = new Set<string>(atcNames.keys());
    for (const leaf of atcLeafToIngredient.keys()) {
      let cur: string | null = leaf;
      while (cur) {
        atcCodes.add(cur);
        cur = atcParent(cur);
      }
    }
    const usedRx = new Set<string>();
    for (const edge of labeled) {
      usedRx.add(edge.src);
      usedRx.add(edge.dst);
    }
    for (const [rxcui, concept] of concepts) if (concept.tty === 'IN') usedRx.add(rxcui);
    for (const set of atcLeafToIngredient.values()) {
      for (const rx of set) if (concepts.get(rx)?.tty === 'IN') usedRx.add(rx);
    }

    const total = usedRx.size + atcCodes.size;
    onProgress({ phase: 'finalizing', processed: 0, total });
    for (const code of atcCodes) {
      writer.insertNode({
        code,
        display: atcNames.get(code) ?? code,
        kind: 'atc-class',
        extra: { atcLevel: ATC_LEN_TO_LEVEL[code.length] ?? null },
      });
    }
    for (const code of atcCodes) {
      const parent = atcParent(code);
      if (parent && atcCodes.has(parent)) writer.insertEdge(parent, code, 0, null);
      else if (!parent) writer.insertEdge(ROOT_CODE, code, 0, null);
    }
    for (const rxcui of usedRx) {
      const concept = concepts.get(rxcui);
      if (!concept) continue;
      writer.insertNode({ code: rxcui, display: concept.display, kind: concept.tty ?? 'CUI', extra: { tty: concept.tty, rxcui } });
    }
    for (const [leaf, rxset] of atcLeafToIngredient) {
      for (const rxcui of rxset) {
        if (concepts.get(rxcui)?.tty === 'IN') writer.insertEdge(leaf, rxcui, 0, 'Ingredients');
      }
    }
    for (const edge of labeled) writer.insertEdge(edge.src, edge.dst, 0, edge.label);
    onProgress({ phase: 'finalizing', processed: total, total });
  },
};
