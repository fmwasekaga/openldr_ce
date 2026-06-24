import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  // Mirror the reference plugin: signal first paint so the host/e2e can await readiness.
  document.body.setAttribute('data-openldr-ready', '1');
}
