import { defineConfig, type Plugin } from 'vitest/config';
import { createRequire } from 'node:module';

// Vite 5 / vite-node strips the "node:" prefix before resolving builtins and
// checks bare "sqlite" against builtinModules — but Node 22's node:sqlite has
// no bare "sqlite" entry (unlike node:fs → "fs"). This plugin intercepts both
// the bare and prefixed id and proxies all exports from the real native module.
function nodeSqlitePlugin(): Plugin {
  const _require = createRequire(import.meta.url);
  return {
    name: 'node-sqlite-builtin',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'sqlite' || id === 'node:sqlite') return '\0node-sqlite-shim';
    },
    load(id) {
      if (id === '\0node-sqlite-shim') {
        // Re-export everything from the real native module via CJS require so
        // that Vite doesn't try to bundle it.
        const mod = _require('node:sqlite');
        const keys = Object.keys(mod);
        const lines = keys.map((k) => `export const ${k} = __mod.${k};`);
        return `const __mod = require('node:sqlite');\n${lines.join('\n')}\n`;
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeSqlitePlugin()],
  test: {
    environment: 'node',
  },
});
