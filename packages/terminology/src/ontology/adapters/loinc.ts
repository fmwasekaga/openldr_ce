import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_CODE, type DetectedDistribution, type IndexWriter, type OntologyAdapter } from '../types';

// LOINC's multiaxial hierarchy. Each row is a node with an IMMEDIATE_PARENT;
// the top "{component}" row has an empty parent. Internal nodes are LOINC Part
// codes (LP...), leaves are measurable LOINC terms. A code may appear under more
// than one parent (the hierarchy is a DAG), so nodes are de-duped by CODE while
// every row contributes an edge.
const HIERARCHY_REL = join('AccessoryFiles', 'ComponentHierarchyBySystem', 'ComponentHierarchyBySystem.csv');
const PANELS_REL = join('AccessoryFiles', 'PanelsAndForms', 'PanelsAndForms.csv');
const ANSWER_LINK_REL = join('AccessoryFiles', 'AnswerFile', 'LoincAnswerListLink.csv');
const ANSWER_LIST_REL = join('AccessoryFiles', 'AnswerFile', 'AnswerList.csv');
const PART_LINK_REL = join('AccessoryFiles', 'PartFile', 'LoincPartLink_Primary.csv');
const PART_MAP_REL = join('AccessoryFiles', 'PartFile', 'PartRelatedCodeMapping.csv');

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((cell) => cell.trim());
}

export const loincAdapter: OntologyAdapter = {
  type: 'loinc',

  detect(folderPath): DetectedDistribution | null {
    const hierarchy = join(folderPath, HIERARCHY_REL);
    if (!existsSync(hierarchy)) return null;
    const st = statSync(hierarchy);
    const files: Record<string, string> = { hierarchy };
    const fileStats = [{ path: hierarchy, size: st.size, mtimeMs: st.mtimeMs }];
    const panels = join(folderPath, PANELS_REL);
    if (existsSync(panels)) {
      const pst = statSync(panels);
      files['panels'] = panels;
      fileStats.push({ path: panels, size: pst.size, mtimeMs: pst.mtimeMs });
    }
    const answerLink = join(folderPath, ANSWER_LINK_REL);
    const answerList = join(folderPath, ANSWER_LIST_REL);
    if (existsSync(answerLink) && existsSync(answerList)) {
      files['answerLink'] = answerLink;
      files['answerList'] = answerList;
      for (const path of [answerLink, answerList]) {
        const s = statSync(path);
        fileStats.push({ path, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
    const partLink = join(folderPath, PART_LINK_REL);
    const partMap = join(folderPath, PART_MAP_REL);
    if (existsSync(partLink) && existsSync(partMap)) {
      files['partLink'] = partLink;
      files['partMap'] = partMap;
      for (const path of [partLink, partMap]) {
        const s = statSync(path);
        fileStats.push({ path, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
    return { type: 'loinc', folderPath, files, fileStats };
  },

  buildIndex(dist, writer: IndexWriter, onProgress): void {
    const text = readFileSync(dist.files['hierarchy']!, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return;
    const header = parseCsvLine(lines[0]!).map((heading) => heading.toUpperCase());
    const col = (name: string): number => header.indexOf(name);
    const iSeq = col('SEQUENCE');
    const iParent = col('IMMEDIATE_PARENT');
    const iCode = col('CODE');
    const iText = col('CODE_TEXT');

    const dataLines = lines.slice(1);
    onProgress({ phase: 'hierarchy', processed: 0, total: dataLines.length });
    const seenNode = new Set<string>();
    dataLines.forEach((line, i) => {
      const c = parseCsvLine(line);
      const code = c[iCode] ?? '';
      if (!code) return;
      const parent = c[iParent] ?? '';
      const display = c[iText] ?? code;
      const seq = Number(c[iSeq] ?? '0') || 0;
      if (!seenNode.has(code)) {
        seenNode.add(code);
        writer.insertNode({
          code,
          display,
          // LP... codes are hierarchy "Part" categories; everything else is a
          // measurable LOINC term (the browsable leaves).
          kind: code.startsWith('LP') ? 'category' : 'term',
          extra: null,
        });
      }
      // Empty IMMEDIATE_PARENT marks a hierarchy root; guard self-loops.
      const parentCode = parent && parent !== code ? parent : ROOT_CODE;
      writer.insertEdge(parentCode, code, seq);
      if (i % 5000 === 0) onProgress({ phase: 'hierarchy', processed: i, total: dataLines.length });
    });
    onProgress({ phase: 'hierarchy', processed: dataLines.length, total: dataLines.length });

    const panelsPath = dist.files['panels'];
    if (panelsPath) {
      const ptext = readFileSync(panelsPath, 'utf8');
      const plines = ptext.split(/\r?\n/).filter((line) => line.trim());
      if (plines.length >= 2) {
        const ph = parseCsvLine(plines[0]!).map((heading) => heading.toUpperCase());
        const pcol = (name: string): number => ph.indexOf(name);
        const iParentLoinc = pcol('PARENTLOINC');
        const iLoinc = pcol('LOINC');
        const iLoincName = pcol('LOINCNAME');
        const iDisplay = pcol('DISPLAYNAMEFORFORM');
        const iSeq = pcol('SEQUENCE');
        const iReq = pcol('OBSERVATIONREQUIREDINPANEL');
        const pdata = plines.slice(1);
        onProgress({ phase: 'panels', processed: 0, total: pdata.length });
        pdata.forEach((line, i) => {
          const c = parseCsvLine(line);
          const panelLoinc = c[iParentLoinc] ?? '';
          const memberLoinc = c[iLoinc] ?? '';
          if (!panelLoinc || !memberLoinc) return;
          if (memberLoinc === panelLoinc) return;
          const memberName = c[iLoincName] ?? memberLoinc;
          const displayName = (c[iDisplay] ?? '').trim() || memberName;
          writer.insertPanelMember({
            panelLoinc,
            memberLoinc,
            memberName,
            displayName,
            sequence: Number(c[iSeq] ?? '0') || 0,
            required: (c[iReq] ?? '').trim().toUpperCase() === 'R',
          });
          if (i % 5000 === 0) onProgress({ phase: 'panels', processed: i, total: pdata.length });
        });
        onProgress({ phase: 'panels', processed: pdata.length, total: pdata.length });
      }
    }

    const answerLinkPath = dist.files['answerLink'];
    const answerListPath = dist.files['answerList'];
    if (answerLinkPath && answerListPath) {
      // 1) Build AnswerListId -> ordered options from AnswerList.csv
      const listText = readFileSync(answerListPath, 'utf8');
      const listLines = listText.split(/\r?\n/).filter((line) => line.trim());
      const byList = new Map<string, { seq: number; value: string; label: string }[]>();
      if (listLines.length >= 2) {
        const lh = parseCsvLine(listLines[0]!).map((heading) => heading.toUpperCase());
        const lc = (name: string): number => lh.indexOf(name);
        const iId = lc('ANSWERLISTID');
        const iVal = lc('ANSWERSTRINGID');
        const iSeq = lc('SEQUENCENUMBER');
        const iText = lc('DISPLAYTEXT');
        for (const line of listLines.slice(1)) {
          const c = parseCsvLine(line);
          const listId = c[iId] ?? '';
          const value = c[iVal] ?? '';
          if (!listId || !value) continue;
          const arr = byList.get(listId) ?? [];
          arr.push({ seq: Number(c[iSeq] ?? '0') || 0, value, label: c[iText] ?? value });
          byList.set(listId, arr);
        }
      }
      // 2) Link each LOINC to its list's options via LoincAnswerListLink.csv
      const linkText = readFileSync(answerLinkPath, 'utf8');
      const linkLines = linkText.split(/\r?\n/).filter((line) => line.trim());
      if (linkLines.length >= 2) {
        const kh = parseCsvLine(linkLines[0]!).map((heading) => heading.toUpperCase());
        const kc = (name: string): number => kh.indexOf(name);
        const iLoinc = kc('LOINCNUMBER');
        const iListId = kc('ANSWERLISTID');
        const kdata = linkLines.slice(1);
        onProgress({ phase: 'answers', processed: 0, total: kdata.length });
        kdata.forEach((line, i) => {
          const c = parseCsvLine(line);
          const loinc = c[iLoinc] ?? '';
          const listId = c[iListId] ?? '';
          if (!loinc || !listId) return;
          for (const option of byList.get(listId) ?? []) {
            writer.insertAnswerOption({ loinc, seq: option.seq, value: option.value, label: option.label });
          }
          if (i % 5000 === 0) onProgress({ phase: 'answers', processed: i, total: kdata.length });
        });
        onProgress({ phase: 'answers', processed: kdata.length, total: kdata.length });
      }
    }

    const partLinkPath = dist.files['partLink'];
    const partMapPath = dist.files['partMap'];
    if (partLinkPath && partMapPath) {
      // 1) PartNumber -> SNOMED maps (equivalent/narrower), SNOMED only
      const mapText = readFileSync(partMapPath, 'utf8');
      const mapLines = mapText.split(/\r?\n/).filter((line) => line.trim());
      const byPart = new Map<string, { snomed: string; equivalence: string }[]>();
      if (mapLines.length >= 2) {
        const mh = parseCsvLine(mapLines[0]!).map((heading) => heading.toUpperCase());
        const mc = (name: string): number => mh.indexOf(name);
        const iPart = mc('PARTNUMBER');
        const iExt = mc('EXTCODEID');
        const iSys = mc('EXTCODESYSTEM');
        const iEq = mc('EQUIVALENCE');
        for (const line of mapLines.slice(1)) {
          const c = parseCsvLine(line);
          const part = c[iPart] ?? '';
          const snomed = c[iExt] ?? '';
          if (!part || !snomed) continue;
          if (!(c[iSys] ?? '').includes('snomed.info/sct')) continue;
          const arr = byPart.get(part) ?? [];
          arr.push({ snomed, equivalence: (c[iEq] ?? '').trim().toLowerCase() });
          byPart.set(part, arr);
        }
      }
      // 2) each term's SYSTEM part -> its SNOMED maps
      const linkText = readFileSync(partLinkPath, 'utf8');
      const linkLines = linkText.split(/\r?\n/).filter((line) => line.trim());
      if (linkLines.length >= 2) {
        const kh = parseCsvLine(linkLines[0]!).map((heading) => heading.toUpperCase());
        const kc = (name: string): number => kh.indexOf(name);
        const iLoinc = kc('LOINCNUMBER');
        const iPartNum = kc('PARTNUMBER');
        const iType = kc('PARTTYPENAME');
        const kdata = linkLines.slice(1);
        onProgress({ phase: 'specimens', processed: 0, total: kdata.length });
        kdata.forEach((line, i) => {
          const c = parseCsvLine(line);
          if ((c[iType] ?? '').toUpperCase() !== 'SYSTEM') return;
          const loinc = c[iLoinc] ?? '';
          const part = c[iPartNum] ?? '';
          if (!loinc || !part) return;
          for (const map of byPart.get(part) ?? []) {
            writer.insertSpecimenMap({ loinc, snomedCode: map.snomed, equivalence: map.equivalence });
          }
          if (i % 5000 === 0) onProgress({ phase: 'specimens', processed: i, total: kdata.length });
        });
        onProgress({ phase: 'specimens', processed: kdata.length, total: kdata.length });
      }
    }
  },
};
