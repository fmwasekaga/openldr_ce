export interface ProducedFile { field: string; objectKey: string; fileName: string; contentType: string; byteSize: number }

/** Extract every blob-backed BinaryRef from a node's output (WorkflowItem[]). */
export function outputBinaries(output: unknown): ProducedFile[] {
  if (!Array.isArray(output)) return [];
  const files: ProducedFile[] = [];
  for (const item of output) {
    const bin = (item as { binary?: Record<string, unknown> })?.binary;
    if (!bin || typeof bin !== 'object') continue;
    for (const [field, v] of Object.entries(bin)) {
      const ref = v as { objectKey?: unknown; fileName?: unknown; contentType?: unknown; byteSize?: unknown };
      if (typeof ref.objectKey === 'string') {
        files.push({
          field,
          objectKey: ref.objectKey,
          fileName: typeof ref.fileName === 'string' ? ref.fileName : (ref.objectKey.split('/').pop() ?? 'file'),
          contentType: typeof ref.contentType === 'string' ? ref.contentType : 'application/octet-stream',
          byteSize: typeof ref.byteSize === 'number' ? ref.byteSize : 0,
        });
      }
    }
  }
  return files;
}
