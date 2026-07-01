import { useEffect, useState } from 'react';
import { Select } from './shared';
import { fetchNodeOptions, type WorkflowNodeOption } from '@/api';

/**
 * Connector picker for hand-written node forms. Reuses the same server-backed
 * option source the declarative form uses (`connectors:<type>` →
 * /api/workflows/node-options), so the list is filtered to connectors of the
 * given host type. Renders the shadcn-backed `<Select>` from ./shared.
 */
export function ConnectorSelect({
  type,
  value,
  onChange,
}: {
  /** Host connector type to filter by, e.g. 'postgres' or 'imap'. */
  type: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [options, setOptions] = useState<WorkflowNodeOption[]>([]);

  useEffect(() => {
    void fetchNodeOptions(`connectors:${type}`)
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [type]);

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a connector…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
