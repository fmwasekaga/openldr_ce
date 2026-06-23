import * as LucideIcons from 'lucide-react';
import { Box, type LucideIcon } from 'lucide-react';

type IconModule = Record<string, LucideIcon>;

/**
 * Resolve a lucide-react icon component by string name. Falls back to a
 * generic Box icon so missing names never break the render.
 */
export function resolveLucideIcon(name: string | undefined): LucideIcon {
  if (!name) return Box;
  const mod = LucideIcons as unknown as IconModule;
  return mod[name] ?? Box;
}

interface NodeIconProps {
  iconName?: string;
  iconUrl?: string;
  className?: string;
  alt?: string;
}

/**
 * Render a node icon: prefer a custom asset URL (e.g. `/node-icons/slack.svg`)
 * so brand logos placed in `public/` trump the lucide fallback.
 */
export function NodeIcon({ iconName, iconUrl, className, alt }: NodeIconProps) {
  if (iconUrl) {
    return <img src={iconUrl} alt={alt ?? ''} className={className} />;
  }
  const Icon = resolveLucideIcon(iconName);
  return <Icon className={className} />;
}
