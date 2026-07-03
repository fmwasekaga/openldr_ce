/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single source of truth for the docs version: the app's package version. Injected at
// build/test time so DOCS_VERSION tracks releases (see src/docs/version.ts).
const pkgVersion = createRequire(import.meta.url)('./package.json').version as string;

export default defineConfig(({ mode }) => ({
  base: '/studio/',
  plugins: [react(), tailwindcss()],
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
