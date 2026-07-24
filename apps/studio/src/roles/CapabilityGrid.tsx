import { useTranslation } from 'react-i18next';
import type { CapabilityGroup } from '@/api';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  totalCapabilityCount, selectedCapabilityCount, groupSelectedCount,
  isGroupFullySelected, isAllSelected, toggleCapability, setGroupSelected, setAllSelected,
} from './capabilityGrid.model';

export interface CapabilityGridProps {
  groups: CapabilityGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}

/**
 * instatic-style capability picker: a global "Select all" + "N of M selected" counter,
 * then one card per domain group, each with its own "Select all" and a checkbox per
 * capability (label + description). All selection math lives in capabilityGrid.model.ts —
 * this component is a thin shadcn shell over those pure functions.
 */
export function CapabilityGrid({ groups, selected, onChange, readOnly = false }: CapabilityGridProps) {
  const { t } = useTranslation();
  const total = totalCapabilityCount(groups);
  const count = selectedCapabilityCount(groups, selected);
  const allSelected = isAllSelected(groups, selected);

  return (
    <div className="flex flex-col gap-3" data-testid="capability-grid">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="capability-select-all"
            data-testid="capability-select-all"
            checked={allSelected}
            disabled={readOnly || total === 0}
            onCheckedChange={(v) => onChange(setAllSelected(groups, selected, v === true))}
          />
          <Label htmlFor="capability-select-all" className="cursor-pointer font-medium">
            {t('roles.selectAll')}
          </Label>
        </div>
        <span className="text-xs text-muted-foreground" data-testid="capability-count">
          {t('roles.selectedCount', { selected: count, total })}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('roles.noCapabilities')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const groupCount = groupSelectedCount(group, selected);
            const groupTotal = group.capabilities.length;
            const groupFull = isGroupFullySelected(group, selected);
            const groupCheckboxId = `capability-group-${group.key}`;
            return (
              <div key={group.key} className="rounded-md border border-border p-3" data-testid={`capability-group-${group.key}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">{t('roles.groupCount', { selected: groupCount, total: groupTotal })}</span>
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <Checkbox
                    id={groupCheckboxId}
                    checked={groupFull}
                    disabled={readOnly || groupTotal === 0}
                    onCheckedChange={(v) => onChange(setGroupSelected(selected, group, v === true))}
                  />
                  <Label htmlFor={groupCheckboxId} className="cursor-pointer text-xs text-muted-foreground">
                    {t('roles.selectAll')}
                  </Label>
                </div>
                <div className="flex flex-col gap-2">
                  {group.capabilities.map((cap) => {
                    const capId = `capability-${cap.key}`;
                    return (
                      <div key={cap.key} className="flex items-start gap-2">
                        <Checkbox
                          id={capId}
                          className="mt-0.5"
                          checked={selected.has(cap.key)}
                          disabled={readOnly}
                          onCheckedChange={() => onChange(toggleCapability(selected, cap.key))}
                        />
                        <Label htmlFor={capId} className="flex cursor-pointer flex-col gap-0.5 font-normal">
                          <span className="text-sm">{cap.label}</span>
                          <span className="text-xs text-muted-foreground">{cap.description}</span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
