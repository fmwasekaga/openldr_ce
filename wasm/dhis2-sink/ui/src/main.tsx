import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  // Readiness is signalled by App's init effect (data-openldr-ready) once the SDK
  // handshake completes and the first data load settles — not here at first paint.
}
