import { useCallback, useRef, useState } from 'react';

export interface UseTemplateHistory<T> {
  pushHistory: () => void;
  recordEdit: () => void;
  undo: () => T | null;
  redo: () => T | null;
  canUndo: boolean;
  canRedo: boolean;
  reset: (state: T) => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function useTemplateHistory<T>(currentState: () => T): UseTemplateHistory<T> {
  const historyRef = useRef<T[]>([]);
  const indexRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, force] = useState(0);
  const refresh = () => force((value) => value + 1);

  const pushHistory = useCallback(() => {
    const snapshot = clone(currentState());
    const next = historyRef.current.slice(0, indexRef.current + 1);
    next.push(snapshot);
    while (next.length > 50) next.shift();
    historyRef.current = next;
    indexRef.current = next.length - 1;
    refresh();
  }, [currentState]);

  const recordEdit = useCallback(() => {
    if (!timerRef.current) pushHistory();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
    }, 500);
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (indexRef.current < 0) return null;
    const current = clone(currentState());
    if (indexRef.current === historyRef.current.length - 1) historyRef.current.push(current);
    const snapshot = historyRef.current[indexRef.current];
    indexRef.current -= 1;
    refresh();
    return clone(snapshot);
  }, [currentState]);

  const redo = useCallback(() => {
    const nextIndex = indexRef.current + 2;
    if (nextIndex >= historyRef.current.length) return null;
    indexRef.current += 1;
    refresh();
    return clone(historyRef.current[nextIndex]);
  }, []);

  const reset = useCallback((state: T) => {
    historyRef.current = [clone(state)];
    indexRef.current = -1;
    refresh();
  }, []);

  return {
    pushHistory,
    recordEdit,
    undo,
    redo,
    canUndo: indexRef.current >= 0,
    canRedo: indexRef.current + 2 < historyRef.current.length,
    reset,
  };
}
