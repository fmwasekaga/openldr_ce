import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // The shebang must stay on line 1. The createRequire shim defines a real
  // `require` in module scope so esbuild's `__require` polyfill delegates to
  // it instead of throwing "Dynamic require of X is not supported" — needed
  // because bundled CJS deps (e.g. dotenv) call require('fs') at runtime.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __openldrCreateRequire } from 'module';",
      'const require = __openldrCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
