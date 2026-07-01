import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTemplateHistory } from './useTemplateHistory';

describe('useTemplateHistory', () => {
  it('undoes and redoes snapshots', () => {
    let state = { name: 'A' };
    const { result } = renderHook(() => useTemplateHistory(() => state));
    act(() => result.current.reset(state));
    act(() => result.current.pushHistory());
    state = { name: 'B' };
    expect(result.current.undo()).toEqual({ name: 'A' });
    expect(result.current.redo()).toEqual({ name: 'B' });
  });

  it('coalesces debounced edits', () => {
    vi.useFakeTimers();
    let state = { name: 'A' };
    const { result } = renderHook(() => useTemplateHistory(() => state));
    act(() => result.current.reset(state));
    act(() => result.current.recordEdit());
    state = { name: 'AB' };
    act(() => result.current.recordEdit());
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.undo()).toEqual({ name: 'A' });
    vi.useRealTimers();
  });
});
