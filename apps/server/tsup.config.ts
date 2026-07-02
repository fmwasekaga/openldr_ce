import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // Deps that must stay external — bundling them breaks runtime file resolution:
  //  - ssh2 / cpu-features: native `.node` addons (via @openldr/bootstrap → SFTP node).
  //  - pdfkit: loads its standard-font `.afm` metric files from disk at runtime (via
  //    @openldr/report-pdf); bundled, those data files don't travel and every report PDF 500s.
  // They aren't in this package's own dependencies, so we also declare them as direct deps
  // (package.json) → pnpm deploy installs them intact in node_modules for the runtime require.
  external: ['ssh2', 'cpu-features', 'pdfkit'],
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
