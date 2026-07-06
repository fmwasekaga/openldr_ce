import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedToggle } from './usePersistedToggle';

beforeEach(() => localStorage.clear());

describe('usePersistedToggle', () => {
  it('defaults, toggles, and persists to localStorage', () => {
    const { result } = renderHook(() => usePersistedToggle('k1', false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('k1')).toBe('true');
  });
  it('reads the persisted value on init', () => {
    localStorage.setItem('k2', 'true');
    const { result } = renderHook(() => usePersistedToggle('k2', false));
    expect(result.current[0]).toBe(true);
  });
  it('set() writes an explicit value', () => {
    const { result } = renderHook(() => usePersistedToggle('k3', true));
    act(() => result.current[2](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('k3')).toBe('false');
  });
});
