import { describe, it, expect, beforeEach } from 'vitest';
import { loadPinned, savePinned, togglePinned, loadLastParams, saveLastParams } from './report-preferences';

beforeEach(() => localStorage.clear());

describe('report preferences', () => {
  it('toggles a pinned id on and off', () => {
    expect(togglePinned([], 'a')).toEqual(['a']);
    expect(togglePinned(['a'], 'a')).toEqual([]);
  });

  it('persists pinned ids to localStorage', () => {
    savePinned(['x', 'y']);
    expect(loadPinned()).toEqual(['x', 'y']);
  });

  it('round-trips last params per report', () => {
    saveLastParams({ 'amr-resistance': { from: '2026-01-01' } });
    expect(loadLastParams()['amr-resistance']).toEqual({ from: '2026-01-01' });
  });

  it('returns safe defaults when storage is empty or malformed', () => {
    localStorage.setItem('reports.pinned', 'not json');
    expect(loadPinned()).toEqual([]);
    expect(loadLastParams()).toEqual({});
  });
});
