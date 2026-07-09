import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { nodeCategories, IMPLEMENTED_TEMPLATE_IDS } from '../constants';
import type { NodeCategory, NodeTemplate } from '../lib/types';
import type { NodeVariant } from './node-types/base-node';
import { NodeIcon, resolveLucideIcon } from '../lib/icons';
import { fetchWorkflowNodes, pluginNodeDeclId, type WorkflowNodeDescriptor } from '@/api';

const VARIANT_ICON_COLORS: Record<NodeVariant, string> = {
  trigger: 'text-emerald-400',
  action: 'text-sky-400',
  code: 'text-slate-300',
  condition: 'text-amber-400',
  loop: 'text-violet-400',
  webhook: 'text-teal-400',
};

function iconColorFor(type: string): string {
  return VARIANT_ICON_COLORS[type as NodeVariant] ?? 'text-zinc-300';
}

/** Sidebar list row: bare icon on the left, name + description stacked on the right. */
function NodeCard({ template }: { template: NodeTemplate }) {
  const iconColor = iconColorFor(template.type);
  // Only templates with a backing handler in this slice are draggable; the rest
  // render disabled ("coming soon") until a later slice adds the handler.
  // Plugin nodes are always available (their handler is the generic plugin-node engine handler).
  const available = template.type === 'plugin-node' || IMPLEMENTED_TEMPLATE_IDS.has(template.id);

  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData('application/reactflow-type', template.type);
    // Stamp `templateId` onto the node's data so the node-config-panel can
    // look up the right form + the backend can route to the right handler
    // (e.g. action templates that share ReactFlow type 'action').
    const dataWithTemplateId = { ...template.defaultData, templateId: template.id };
    event.dataTransfer.setData(
      'application/reactflow-data',
      JSON.stringify(dataWithTemplateId),
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable={available}
      onDragStart={available ? onDragStart : (e) => e.preventDefault()}
      aria-disabled={!available}
      title={available ? template.description : 'Coming soon'}
      className={cn(
        'group flex items-center gap-2.5 rounded-md border border-border bg-background/40 px-2 py-1.5 transition-colors',
        available
          ? 'cursor-grab hover:border-violet-500/50 hover:bg-secondary/60 active:cursor-grabbing'
          : 'cursor-not-allowed opacity-50',
      )}
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center transition-transform group-hover:scale-110',
          iconColor,
        )}
      >
        <NodeIcon
          iconName={template.icon}
          iconUrl={template.iconUrl}
          alt={template.label}
          className="h-5 w-5"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium leading-tight text-foreground">
          {template.label}
        </div>
        <div className="truncate text-[10.5px] leading-tight text-muted-foreground">
          {template.description}
        </div>
      </div>
    </div>
  );
}

interface CategorySectionProps {
  category: NodeCategory;
  expanded: boolean;
  onToggle: () => void;
}

function CategorySection({ category, expanded, onToggle }: CategorySectionProps) {
  const CategoryIcon = resolveLucideIcon(category.icon);
  return (
    <div className="mb-3 last:mb-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-secondary/60"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <CategoryIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {category.name}
        </span>
        <span className="ml-auto rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {category.items.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1">
          {category.items.map((template) => (
            <NodeCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}

const COLLAPSED_WIDTH = 'w-12';
const EXPANDED_WIDTH = 'w-72';

function pluginTemplate(d: WorkflowNodeDescriptor): NodeTemplate {
  const defaults: Record<string, unknown> = {};
  for (const f of d.config) if (f.default !== undefined) defaults[f.key] = f.default;
  return {
    id: d.id,
    type: 'plugin-node',
    label: d.label,
    description: d.description || `${d.kind} node from ${d.pluginId}`,
    icon: 'Puzzle',
    keywords: [d.pluginId ?? '', d.kind],
    defaultData: {
      label: d.label,
      pluginId: d.pluginId,
      nodeId: pluginNodeDeclId(d),
      kind: d.kind,
      config: defaults,
      iconName: 'Puzzle',
      templateId: 'plugin-node',
    } as never,
  };
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [pluginCats, setPluginCats] = useState<NodeCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() =>
    // Default: every category collapsed so the library reads as a compact index on first load.
    Object.fromEntries(nodeCategories.map((c) => [c.name, false])),
  );

  useEffect(() => {
    void fetchWorkflowNodes()
      .then((nodes) => {
        const plugins = nodes.filter((n) => n.source === 'plugin');
        if (plugins.length === 0) { setPluginCats([]); return; }
        setPluginCats([{ name: 'Plugins', icon: 'Puzzle', items: plugins.map(pluginTemplate) }]);
      })
      .catch(() => setPluginCats([]));
  }, []);

  const allCats = useMemo(() => [...nodeCategories, ...pluginCats], [pluginCats]);

  /** When a search term is entered, build a single synthetic "Search results" category. */
  const visibleCategories: NodeCategory[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCats;

    const matches: NodeTemplate[] = [];
    for (const cat of allCats) {
      for (const item of cat.items) {
        const haystack = [
          item.label,
          item.description,
          item.id,
          ...(item.keywords ?? []),
        ]
          .join(' ')
          .toLowerCase();
        if (haystack.includes(q)) matches.push(item);
      }
    }
    return [
      {
        name: `Results (${matches.length})`,
        icon: 'Search',
        items: matches,
      },
    ];
  }, [search, allCats]);

  // When searching, force the synthetic results category open.
  const isExpanded = (name: string) =>
    search.trim().length > 0 ? true : expandedCategories[name] ?? false;

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => ({ ...prev, [name]: !(prev[name] ?? false) }));
  };

  if (collapsed) {
    return (
      <aside
        className={cn(
          COLLAPSED_WIDTH,
          'flex h-full shrink-0 flex-col items-center border-r border-border bg-card py-3',
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand node library"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        EXPANDED_WIDTH,
        'flex h-full shrink-0 flex-col border-r border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Node Library
          </h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">
            Drag onto canvas to add
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse node library"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background/40 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {visibleCategories.map((category) => (
          <CategorySection
            key={category.name}
            category={category}
            expanded={isExpanded(category.name)}
            onToggle={() => toggleCategory(category.name)}
          />
        ))}
        {visibleCategories.every((c) => c.items.length === 0) && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            No nodes match “{search}”.
          </div>
        )}
      </div>
    </aside>
  );
}
