import { useState } from 'react';

const KEY = 'openldr-sidebar-collapsed';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function useSidebar(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(stored);
  return [
    collapsed,
    () =>
      setCollapsed((c) => {
        const next = !c;
        try {
          localStorage.setItem(KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      }),
  ];
}
