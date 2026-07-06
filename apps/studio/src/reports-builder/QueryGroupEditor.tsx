import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';
import { RuleValueEditor } from './RuleValueEditor';
import { newRule, newGroup, type ConditionGroup, type ConditionNode, type ConditionRule } from './queryTreeModel';

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

function RuleRow({ rule, dimensions, parameters, onChange, onRemove, idPrefix }: {
  rule: ConditionRule; dimensions: ModelDimension[]; parameters: ReportParam[];
  onChange: (r: ConditionRule) => void; onRemove: () => void; idPrefix: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2">
      <div className="flex gap-1">
        <select aria-label={`${idPrefix}-dimension`} className="h-7 flex-1 rounded border border-border bg-background text-xs"
          value={rule.dimension} onChange={(e) => onChange({ ...rule, dimension: e.target.value })}>
          {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <select aria-label={`${idPrefix}-op`} className="h-7 w-20 rounded border border-border bg-background text-xs"
          value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value })}>
          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`${idPrefix}-remove`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <RuleValueEditor op={rule.op} value={rule.value} parameters={parameters} onChange={(v) => onChange({ ...rule, value: v })} idPrefix={idPrefix} />
    </div>
  );
}

export function QueryGroupEditor({ group, dimensions, parameters, onChange, onRemove, depth = 0 }: {
  group: ConditionGroup; dimensions: ModelDimension[]; parameters: ReportParam[];
  onChange: (g: ConditionGroup) => void; onRemove?: () => void; depth?: number;
}): JSX.Element {
  const { t } = useTranslation();
  const setChild = (i: number, child: ConditionNode) => onChange({ ...group, children: group.children.map((c, j) => (j === i ? child : c)) });
  const removeChild = (i: number) => onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  const setComb = (combinator: 'and' | 'or') => onChange({ ...group, combinator });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" style={{ marginLeft: depth ? 8 : 0 }}>
      <div className="flex items-center justify-between">
        <div className="flex">
          <Button type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]" aria-label="and"
            variant={group.combinator === 'and' ? 'default' : 'outline'} onClick={() => setComb('and')}>{t('reportBuilder.tree.and')}</Button>
          <Button type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]" aria-label="or"
            variant={group.combinator === 'or' ? 'default' : 'outline'} onClick={() => setComb('or')}>{t('reportBuilder.tree.or')}</Button>
        </div>
        {onRemove && <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={t('reportBuilder.tree.removeGroup')} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      {group.children.map((child, i) => child.kind === 'rule'
        ? <RuleRow key={i} rule={child} dimensions={dimensions} parameters={parameters} onChange={(r) => setChild(i, r)} onRemove={() => removeChild(i)} idPrefix={`g${depth}-r${i}`} />
        : <QueryGroupEditor key={i} group={child} dimensions={dimensions} parameters={parameters} onChange={(g) => setChild(i, g)} onRemove={() => removeChild(i)} depth={depth + 1} />)}
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChange({ ...group, children: [...group.children, newRule(dimensions)] })}>{t('reportBuilder.tree.addRule')}</Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChange({ ...group, children: [...group.children, newGroup()] })}>{t('reportBuilder.tree.addGroup')}</Button>
      </div>
    </div>
  );
}
