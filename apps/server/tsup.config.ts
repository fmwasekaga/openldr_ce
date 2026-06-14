import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // tsup defaults removeNodeProtocol:true, which strips the "node:" prefix.
  // node:sqlite (Node 22+) has no bare "sqlite" fallback, so the stripped
  // import fails at runtime. Keep "node:sqlite" intact in the bundle output.
  removeNodeProtocol: false,
  // The createRequire shim defines a real `require` in module scope so
  // esbuild's `__require` polyfill delegates to it instead of throwing
  // "Dynamic require of X is not supported" — needed because bundled CJS
  // deps (e.g. dotenv) call require('fs') at runtime under ESM output.
  banner: {
    js: [
      "import { createRequire as __openldrCreateRequire } from 'module';",
      'const require = __openldrCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
