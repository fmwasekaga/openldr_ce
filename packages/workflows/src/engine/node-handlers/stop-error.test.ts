import { describe, it, expect } from 'vitest';
import { stopErrorHandler } from './stop-error';
import { createContext } from '../execution-context';

const node = (errorMessage?: string) => ({ id: 's1', type: 'action', data: { action: 'stop-error', config: errorMessage === undefined ? {} : { errorMessage } } });

describe('stopErrorHandler', () => {
  it('throws the configured message', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(stopErrorHandler(node('boom'), ctx, [])).rejects.toThrow('boom');
  });

  it('resolves templates in the message', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      stopErrorHandler(node('bad: {{ $json.reason }}'), ctx, [{ json: { reason: 'nope' } }]),
    ).rejects.toThrow('bad: nope');
  });

  it('falls back to a default message when none is set', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(stopErrorHandler(node(), ctx, [])).rejects.toThrow('Workflow stopped');
  });
});
