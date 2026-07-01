import { Puzzle, Share2, BarChart3, Database, Plug, Settings, FileText, type LucideIcon } from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  puzzle: Puzzle, 'share-2': Share2, 'bar-chart-3': BarChart3, database: Database, plug: Plug, settings: Settings, 'file-text': FileText,
};

/** Resolve a manifest nav icon name to a lucide component, falling back to Puzzle. */
export function pluginIcon(name: string | undefined): LucideIcon {
  return (name && MAP[name]) || Puzzle;
}
