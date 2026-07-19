/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single source of truth for the docs version: the app's package version. Injected at
// build/test time so DOCS_VERSION tracks releases (see src/docs/version.ts).
const pkgVersion = createRequire(import.meta.url)('./package.json').version as string;

// Dev-only: Vite serves the SPA under base `/studio/` and, for a bare `/studio` (no trailing
// slash), shows a "did you mean /studio/" notice instead of redirecting. Send a 302 so the bare
// path just works in dev (nginx handles this in production).
function redirectStudioBase(): Plugin {
  return {
    name: 'redirect-studio-base',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (path === '/studio') {
          res.writeHead(302, { Location: '/studio/' + (query ? `?${query}` : '') });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/studio/',
  plugins: [react(), tailwindcss(), redirectStudioBase()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // react-grid-layout / react-draggable / react-resizable reference `process.env.NODE_ENV`
  // at runtime; without this define, `process` is undefined in the dev browser and the
  // drag/resize start handlers throw `process is not defined`, silently disabling them.
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
}));
