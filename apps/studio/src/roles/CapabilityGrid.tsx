import { useTranslation } from 'react-i18next';
import type { CapabilityGroup } from '@/api';
import { Switch } from '@/components/ui/switch';
import {
  totalCapabilityCount, selectedCapabilityCount, groupSelectedCount, toggleCapability,
} from './capabilityGrid.model';

export interface CapabilityGridProps {
  groups: CapabilityGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}

/**
 * instatic-style capability picker: a "N of M selected" counter, then one card per domain
 * group (each with its own "x/y" count) and a switch per capability (label + description).
 * There is no "select all" control — capabilities are toggled one at a time, deliberately,
 * to avoid accidentally granting a broad set of permissions in one click. All selection math
 * lives in capabilityGrid.model.ts — this component is a thin shadcn shell over those pure
 * functions.
 */
export function CapabilityGrid({ groups, selected, onChange, readOnly = false }: CapabilityGridProps) {
  const { t } = useTranslation();
  const total = totalCapabilityCount(groups);
  const count = selectedCapabilityCount(groups, selected);

  return (
    <div className="flex flex-col gap-3" data-testid="capability-grid">
      <div className="flex items-center justify-end gap-3">
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
            return (
              <div key={group.key} className="rounded-md border border-border p-3" data-testid={`capability-group-${group.key}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">{t('roles.groupCount', { selected: groupCount, total: groupTotal })}</span>
                </div>
                <div className="flex flex-col gap-4">
                  {group.capabilities.map((cap) => {
                    const capId = `capability-${cap.key}`;
                    return (
                      <div key={cap.key} className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium">{cap.label}</div>
                          <div className="text-xs text-muted-foreground">{cap.description}</div>
                        </div>
                        <Switch
                          data-testid={capId}
                          checked={selected.has(cap.key)}
                          disabled={readOnly}
                          onCheckedChange={() => onChange(toggleCapability(selected, cap.key))}
                          aria-label={cap.label}
                        />
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
