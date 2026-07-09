import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Loader2, Search } from 'lucide-react';
import {
  ontologyChildren,
  ontologyNodeDetail,
  ontologyPath,
  ontologyRoots,
  ontologySearch,
  type OntologyBreadcrumb,
  type OntologyNode,
  type OntologyType,
} from '../../api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { TruncatedText } from '../../components/ui/truncated-text';

interface OntologyBrowserProps {
  codingSystemId: string;
  systemName: string;
  mode?: 'browse' | 'picker';
  ontologyType?: OntologyType;
  onPick?: (node: { code: string; display: string }) => void;
}

const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const RXNORM_CAVEAT_KINDS = new Set(['SCD', 'SCDF', 'SCDC', 'SBD', 'SBDC', 'SBDF', 'BN', 'GPCK', 'BPCK']);

interface TreeRowProps {
  node: OntologyNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  loading: boolean;
  children: OntologyNode[] | undefined;
  onToggle: (node: OntologyNode) => void;
  onSelect: (node: OntologyNode) => void;
  ctx: TreeCtx;
}

interface TreeCtx {
  expandedCodes: Set<string>;
  selectedCode: string | null;
  loadingCodes: Set<string>;
  childCache: Map<string, OntologyNode[]>;
  onToggle: (node: OntologyNode) => void;
  onSelect: (node: OntologyNode) => void;
  highlightCode: string | null;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  groupCountLabel: (label: string, count: number) => string;
}

function renderChildren(parent: OntologyNode, children: OntologyNode[], depth: number, ctx: TreeCtx): JSX.Element {
  const renderRow = (child: OntologyNode): JSX.Element => (
    <TreeRow
      key={child.code}
      node={child}
      depth={depth}
      expanded={ctx.expandedCodes.has(child.code)}
      selected={ctx.selectedCode === child.code}
      loading={ctx.loadingCodes.has(child.code)}
      children={ctx.childCache.get(child.code)}
      onToggle={ctx.onToggle}
      onSelect={ctx.onSelect}
      ctx={ctx}
    />
  );

  const grouped = children.some((c) => c.group !== null);
  if (!grouped) return <>{children.map(renderRow)}</>;

  const order: string[] = [];
  const buckets = new Map<string, OntologyNode[]>();
  for (const child of children) {
    const label = child.group ?? '';
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(child);
  }

  return (
    <>
      {order.map((label) => {
        const rows = buckets.get(label)!;
        const key = `${parent.code}::${label}`;
        const collapsed = ctx.collapsedGroups.has(key);
        return (
          <Fragment key={key}>
            <button
              type="button"
              onClick={() => ctx.onToggleGroup(key)}
              className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-[rgba(70,130,180,0.06)]"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
              <TruncatedText text={ctx.groupCountLabel(label, rows.length)} className="min-w-0" />
            </button>
            {!collapsed && rows.map(renderRow)}
          </Fragment>
        );
      })}
    </>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  loading,
  children,
  onToggle,
  onSelect,
  ctx,
}: TreeRowProps): JSX.Element {
  const hasChildren = node.childCount > 0;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (ctx.highlightCode === node.code && rowRef.current) rowRef.current.scrollIntoView({ block: 'center' });
  }, [ctx.highlightCode, node.code]);

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        onClick={() => onSelect(node)}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)] ${
          selected ? 'bg-[rgba(70,130,180,0.12)] shadow-[inset_2px_0_0_#4682b4]' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              onToggle(node);
            }
          }}
        >
          {hasChildren ? (
            loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : null}
        </span>
        <TruncatedText text={node.display} className="min-w-0 flex-1 text-foreground" />
        {node.kind && (
          <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[9px] uppercase">
            {node.kind}
          </Badge>
        )}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.code}</span>
      </button>
      {expanded && children && renderChildren(node, children, depth + 1, ctx)}
    </>
  );
}

export function OntologyBrowser({
  codingSystemId,
  mode = 'browse',
  ontologyType,
  onPick,
}: OntologyBrowserProps): JSX.Element {
  const [roots, setRoots] = useState<OntologyNode[]>([]);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [childCache, setChildCache] = useState<Map<string, OntologyNode[]>>(new Map());
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [loadingCodes, setLoadingCodes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<OntologyNode | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<OntologyBreadcrumb[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<OntologyNode[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setRootsLoading(true);
    void ontologyRoots(codingSystemId)
      .then((rows) => {
        if (alive) setRoots(rows);
      })
      .finally(() => {
        if (alive) setRootsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [codingSystemId]);

  const ensureChildren = useCallback(
    async (code: string): Promise<OntologyNode[]> => {
      const cached = childCache.get(code);
      if (cached) return cached;
      setLoadingCodes((prev) => new Set(prev).add(code));
      try {
        const rows = await ontologyChildren(codingSystemId, code);
        setChildCache((prev) => new Map(prev).set(code, rows));
        return rows;
      } finally {
        setLoadingCodes((prev) => {
          const next = new Set(prev);
          next.delete(code);
          return next;
        });
      }
    },
    [childCache, codingSystemId],
  );

  const handleToggle = useCallback(
    (node: OntologyNode) => {
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(node.code)) {
          next.delete(node.code);
        } else {
          next.add(node.code);
          if (!childCache.has(node.code)) void ensureChildren(node.code);
        }
        return next;
      });
    },
    [childCache, ensureChildren],
  );

  const handleToggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: OntologyNode) => {
      setSelectedCode(node.code);
      setCopied(false);
      setDetailLoading(true);
      setBreadcrumb([]);
      void ontologyNodeDetail(codingSystemId, node.code)
        .then((n) => setDetail(n))
        .finally(() => setDetailLoading(false));

      if (ontologyType === 'rxnorm' && node.kind !== 'atc-class') {
        void ontologyPath(codingSystemId, node.code)
          .then((p) => setBreadcrumb(p))
          .catch(() => setBreadcrumb([]));
      }
    },
    [codingSystemId, ontologyType],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const q = searchInput.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      void ontologySearch(codingSystemId, q)
        .then((rows) => setSearchResults(rows))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput, codingSystemId]);

  const handleResultClick = useCallback(
    async (node: OntologyNode) => {
      const path = await ontologyPath(codingSystemId, node.code);
      const ancestors = path.slice(0, -1);
      for (const crumb of ancestors) await ensureChildren(crumb.code);
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        for (const crumb of ancestors) next.add(crumb.code);
        return next;
      });
      setSearchInput('');
      setSearchResults(null);
      setHighlightCode(node.code);
      handleSelect(node);
    },
    [codingSystemId, ensureChildren, handleSelect],
  );

  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const ctx: TreeCtx = {
    expandedCodes,
    selectedCode,
    loadingCodes,
    childCache,
    onToggle: handleToggle,
    onSelect: handleSelect,
    highlightCode,
    collapsedGroups,
    onToggleGroup: handleToggleGroup,
    groupCountLabel: (label, count) => `${label} (${count})`,
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search the ontology..."
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {searchResults !== null ? (
            searching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matches.</p>
            ) : (
              searchResults.map((node) => (
                <button
                  key={node.code}
                  type="button"
                  onClick={() => void handleResultClick(node)}
                  className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                >
                  <TruncatedText text={node.display} className="min-w-0 flex-1 text-foreground" />
                  {node.kind && (
                    <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[9px] uppercase">
                      {node.kind}
                    </Badge>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.code}</span>
                </button>
              ))
            )
          ) : rootsLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          ) : roots.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">This index is empty.</p>
          ) : (
            roots.map((node) => (
              <TreeRow
                key={node.code}
                node={node}
                depth={0}
                expanded={expandedCodes.has(node.code)}
                selected={selectedCode === node.code}
                loading={loadingCodes.has(node.code)}
                children={childCache.get(node.code)}
                onToggle={handleToggle}
                onSelect={handleSelect}
                ctx={ctx}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex w-80 shrink-0 flex-col overflow-auto">
        {detailLoading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : !detail ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Select a node to see details.
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {ontologyType === 'rxnorm' && detail.kind !== 'atc-class' && breadcrumb.length > 0 && (
              <nav className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground">
                {breadcrumb.map((crumb, i) => (
                  <Fragment key={crumb.code}>
                    {i > 0 && <span className="text-muted-foreground/60">/</span>}
                    <TruncatedText text={crumb.display} className="min-w-0" />
                  </Fragment>
                ))}
              </nav>
            )}
            <div>
              <h3 className="text-base font-semibold leading-tight text-foreground">{detail.display}</h3>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-xs text-primary">{detail.code}</span>
                {detail.kind && (
                  <Badge variant="outline" className="whitespace-nowrap text-[9px] uppercase">
                    {detail.kind}
                  </Badge>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Children</dt>
              <dd className="font-mono text-foreground">{detail.childCount}</dd>
              {detail.extra &&
                Object.entries(detail.extra)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="truncate text-muted-foreground">{k}</dt>
                      <dd className="break-words text-foreground">{String(v)}</dd>
                    </Fragment>
                  ))}
            </dl>

            {ontologyType === 'rxnorm' && detail.kind !== 'atc-class' && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  FHIR coding
                </span>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">system</dt>
                  <dd className="break-all font-mono text-foreground">{RXNORM_SYSTEM}</dd>
                  <dt className="text-muted-foreground">code</dt>
                  <dd className="font-mono text-foreground">{detail.code}</dd>
                  <dt className="text-muted-foreground">display</dt>
                  <dd className="break-words text-foreground">{detail.display}</dd>
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5 text-xs"
                  onClick={() =>
                    void copy(JSON.stringify({ system: RXNORM_SYSTEM, code: detail.code, display: detail.display }))
                  }
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy FHIR coding
                </Button>
              </div>
            )}

            {ontologyType === 'rxnorm' && RXNORM_CAVEAT_KINDS.has(detail.kind) && (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                RxNorm includes US prescribable drugs and packs; verify local formulary availability before using this
                concept as a target.
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {mode === 'picker' && (
                <Button
                  size="sm"
                  className="h-8 w-full gap-2 text-xs"
                  onClick={() => onPick?.({ code: detail.code, display: detail.display })}
                >
                  Use as target
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 text-xs"
                  onClick={() => void copy(detail.code)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy code
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 text-xs"
                  onClick={() => void copy(`${detail.code}  ${detail.display}`)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy code + display
                </Button>
              </div>
              {copied && <span className="text-center text-[11px] text-success">Copied</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
