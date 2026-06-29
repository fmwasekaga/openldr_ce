// Dev launcher. Registers tsx in-process via its API instead of through `tsx watch` /
// `--import tsx`, which inject the tsx loader into process.execArgv. Worker threads spawned by
// the app inherit execArgv, so any such worker re-runs the tsx loader, which calls
// process.setSourceMapsEnabled(true). With source maps on, Node tries to cache the source map
// of Extism's background worker — a `data:` URL module whose body ends with
// `//# sourceMappingURL=worker.js.map` — and `new URL('worker.js.map', 'data:...')` throws
// ERR_INVALID_URL on a process.nextTick, an uncaught exception that crashes the whole server
// (hit when "Pull metadata" / a DHIS2 push takes the egress worker path). Registering tsx
// programmatically keeps source maps on the main thread (readable stack traces) while leaving
// execArgv clean, so spawned workers never enable source maps. `node --watch` (in the dev
// script) still restarts on edits to the tsx-loaded .ts graph. Production runs `node dist/...`
// with an empty execArgv, so it was never affected.
import { register } from 'tsx/esm/api';

register();
await import('./src/index.ts');
