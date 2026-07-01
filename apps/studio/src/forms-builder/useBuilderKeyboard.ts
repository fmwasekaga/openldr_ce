import { useEffect } from 'react';

export interface BuilderKeyboardHandlers {
  focusSearch: () => void;
  next: () => void;
  previous: () => void;
  open: () => void;
  toggle: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
}

export function useBuilderKeyboard(handlers: BuilderKeyboardHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); handlers.focusSearch(); return; }
      if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); handlers.redo(); return; }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); handlers.undo(); return; }
      if (isTypingTarget(event.target)) return;
      if (event.key === 'j' || event.key === 'ArrowDown') handlers.next();
      else if (event.key === 'k' || event.key === 'ArrowUp') handlers.previous();
      else if (event.key === 'Enter') handlers.open();
      else if (event.key === ' ') { event.preventDefault(); handlers.toggle(); }
      else if (event.key.toLowerCase() === 'd' && mod) { event.preventDefault(); handlers.duplicate(); }
      else if (event.key.toLowerCase() === 'd') handlers.remove();
      else if (event.key.toLowerCase() === 'a' && mod) { event.preventDefault(); handlers.selectAll(); }
      else if (event.key === 'Escape') handlers.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
