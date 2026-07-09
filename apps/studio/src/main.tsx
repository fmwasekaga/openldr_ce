import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Must run before pdfjs-dist loads (see PDF Document tab): polyfills
// bleeding-edge JS built-ins pdfjs-dist@6 calls with no fallback, for browsers
// older than their native landing. Uint8Array.prototype.toHex/toBase64 etc.
// (Chrome 140+) and Map/WeakMap.prototype.getOrInsertComputed (TC39 upsert).
import './lib/uint8-hex-polyfill';
import './lib/map-upsert-polyfill';
import './tokens.css';
import '@glideapps/glide-data-grid/dist/index.css';
import './i18n';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/studio">
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
