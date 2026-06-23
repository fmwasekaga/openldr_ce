import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Tracks the app theme (set as `data-theme` on <html>) so toasts match light/dark. */
function useThemeAttr(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function Toaster(props: ToasterProps) {
  const theme = useThemeAttr();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  );
}
