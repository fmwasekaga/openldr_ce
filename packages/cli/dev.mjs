// Dev launcher for the CLI (`pnpm openldr ...`). Registers tsx in-process via its API instead
// of running under the `tsx` CLI, which injects the tsx loader into process.execArgv. Any
// worker_threads spawned by a command (notably Extism's egress worker for a DHIS2 push) inherit
// execArgv, re-run the tsx loader, and call process.setSourceMapsEnabled(true); Node then crashes
// caching the Extism worker's `data:`-URL `//# sourceMappingURL=worker.js.map` (ERR_INVALID_URL on
// a nextTick). Registering tsx programmatically keeps source maps on the main thread but out of
// execArgv, so spawned workers never enable them. See apps/server/dev.mjs for the same fix on the
// server. Production uses the built `dist/index.js` (empty execArgv) and was never affected.
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';

register();
// Keep argv[1] pointing at the real entry so commander derives the same program name as before.
process.argv[1] = fileURLToPath(new URL('./src/index.ts', import.meta.url));
await import('./src/index.ts');
