import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocLocale } from './useDocLocale';

beforeEach(() => localStorage.clear());

describe('useDocLocale', () => {
  it('defaults to en', () => {
    const { result } = renderHook(() => useDocLocale());
    expect(result.current[0]).toBe('en');
  });

  it('persists the chosen locale', () => {
    const { result } = renderHook(() => useDocLocale());
    act(() => result.current[1]('fr'));
    expect(result.current[0]).toBe('fr');
    expect(localStorage.getItem('openldr-docs-locale')).toBe('fr');
  });
});
