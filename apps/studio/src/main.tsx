import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Must run before pdfjs-dist loads (see PDF Document tab): polyfills
// Uint8Array.prototype.toHex/toBase64 etc. for browsers older than Chrome 140.
import './lib/uint8-hex-polyfill';
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
