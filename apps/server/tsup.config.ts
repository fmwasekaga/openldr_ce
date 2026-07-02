import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // Native addons reachable only transitively (via @openldr/bootstrap → ssh2 for the SFTP/FTP
  // node; cpu-features is ssh2's optional native speedup). They aren't in this package's own
  // dependencies, so esbuild would try to BUNDLE them and fail resolving their prebuilt `.node`
  // binaries. Keep them external — required from node_modules at runtime (pnpm deploy ships them).
  external: ['ssh2', 'cpu-features'],
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
