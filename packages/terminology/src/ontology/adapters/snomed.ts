import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT_CODE, type DetectedDistribution, type FileStat, type IndexWriter, type OntologyAdapter } from '../types';

const IS_A = '116680003';
const FSN = '900000000000003001';
const ROOT_CONCEPT = '138875005';

function findSnapshotFile(dir: string, prefix: string): string | null {
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((file) => file.startsWith(prefix) && file.endsWith('.txt'));
  return hit ? join(dir, hit) : null;
}

async function streamLines(path: string, onRow: (cols: string[]) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line) continue;
    onRow(line.split('\t'));
  }
}

export const snomedAdapter: OntologyAdapter = {
  type: 'snomed',

  detect(folderPath): DetectedDistribution | null {
    const termDir = join(folderPath, 'Snapshot', 'Terminology');
    const desc = findSnapshotFile(termDir, 'sct2_Description_Snapshot');
    const rel = findSnapshotFile(termDir, 'sct2_Relationship_Snapshot');
    if (!desc || !rel) return null;
    const stats: FileStat[] = [desc, rel].map((path) => {
      const st = statSync(path);
      return { path, size: st.size, mtimeMs: st.mtimeMs };
    });
    return { type: 'snomed', folderPath, files: { description: desc, relationship: rel }, fileStats: stats };
  },

  async buildIndex(dist, writer: IndexWriter, onProgress): Promise<void> {
    // Pass 1: FSN names (active, typeId=FSN). Keep the first active FSN per concept.
    // Description cols: 0 id, 1 effectiveTime, 2 active, 4 conceptId, 6 typeId, 7 term
    const names = new Map<string, string>();
    onProgress({ phase: 'descriptions', processed: 0, total: null });
    let dCount = 0;
    await streamLines(dist.files['description']!, (cols) => {
      if (cols[2] !== '1' || cols[6] !== FSN) return;
      const conceptId = cols[4]!;
      if (!names.has(conceptId)) names.set(conceptId, cols[7] ?? conceptId);
      if (++dCount % 50000 === 0) onProgress({ phase: 'descriptions', processed: dCount, total: null });
    });

    // Pass 2: active IS-A edges. child=sourceId(4), parent=destinationId(5).
    const edges: Array<{ child: string; parent: string }> = [];
    const concepts = new Set<string>();
    onProgress({ phase: 'relationships', processed: 0, total: null });
    let rCount = 0;
    await streamLines(dist.files['relationship']!, (cols) => {
      if (cols[2] !== '1' || cols[7] !== IS_A) return;
      const child = cols[4]!;
      const parent = cols[5]!;
      edges.push({ child, parent });
      concepts.add(child);
      concepts.add(parent);
      if (++rCount % 100000 === 0) onProgress({ phase: 'relationships', processed: rCount, total: null });
    });

    onProgress({ phase: 'finalizing', processed: 0, total: concepts.size });
    for (const code of concepts) {
      writer.insertNode({
        code,
        display: names.get(code) ?? code,
        kind: 'concept',
        extra: { fsn: names.get(code) ?? null },
      });
    }
    for (const edge of edges) writer.insertEdge(edge.parent, edge.child, 0);
    if (concepts.has(ROOT_CONCEPT)) writer.insertEdge(ROOT_CODE, ROOT_CONCEPT, 0);
    onProgress({ phase: 'finalizing', processed: concepts.size, total: concepts.size });
  },
};
