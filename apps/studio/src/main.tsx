import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
