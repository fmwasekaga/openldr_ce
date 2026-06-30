import type { NodeHandler } from './types';

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * Date helper. Operations:
 *  - 'now'      → current time as ISO into outputField
 *  - 'format'   → parse field → ISO into outputField
 *  - 'add'      → field + amount*unit → ISO
 *  - 'subtract' → field - amount*unit → ISO
 * An unparseable field writes null.
 */
export const dateTimeHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const operation = (config.operation as string) ?? 'format';
  const outputField = (config.outputField as string) || 'date';
  const amount = Number(config.amount ?? 0);
  const unit = (config.unit as string) ?? 'days';
  const offset = (Number.isFinite(amount) ? amount : 0) * (UNIT_MS[unit] ?? 0);

  return input.map((item) => {
    const json: Record<string, unknown> = { ...item.json };
    let date: Date;
    if (operation === 'now') {
      date = new Date();
    } else {
      date = new Date(item.json[field] as string | number);
      if (Number.isNaN(date.getTime())) {
        json[outputField] = null;
        return { json };
      }
    }
    if (operation === 'add') date = new Date(date.getTime() + offset);
    if (operation === 'subtract') date = new Date(date.getTime() - offset);
    json[outputField] = date.toISOString();
    return { json };
  });
};
