export interface RunnerHostFns {
  log(level: string, msg: string): void;
  progress(done: number, total: number): void;
}

export interface RunOptions {
  entrypoint: string;
  wasi: boolean;
  memoryMb: number;
  timeoutMs: number;
  host: RunnerHostFns;
}

/**
 * Executes a wasm plugin once and returns its raw output bytes. The only
 * abstraction over the Extism host SDK — everything else is tested against a
 * fake implementation of this interface.
 */
export interface PluginRunner {
  run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array>;
}
