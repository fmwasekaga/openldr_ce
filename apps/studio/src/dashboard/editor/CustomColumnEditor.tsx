import { useState } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { uniqueCustomKey, deriveCustomLabel, type CustomColumn, type CustomColumnExpr, type CustomColumnOperand } from './customColumns.model';

type Dim = { key: string; label: string; kind: 'string' | 'date' | 'number' };

const defaultOperand = (t: CustomColumnOperand['type']): CustomColumnOperand =>
  t === 'field' ? { type: 'field', dimension: '' } : t === 'string' ? { type: 'string', value: '' } : { type: 'number', value: 0 };

/** One operand: a field reference or a literal. `allowString` is false for arithmetic operands.
 *  `numericOnly` restricts the field dropdown to number-kind dimensions (arithmetic operands). */
function OperandInput({ operand, dims, allowString, numericOnly, onChange }: {
  operand: CustomColumnOperand; dims: Dim[]; allowString: boolean; numericOnly: boolean; onChange: (o: CustomColumnOperand) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={operand.type} onValueChange={(t) => onChange(defaultOperand(t as CustomColumnOperand['type']))}>
        <SelectTrigger aria-label="Operand type" className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="field">Field</SelectItem>
          {allowString && <SelectItem value="string">Text</SelectItem>}
          <SelectItem value="number">Number</SelectItem>
        </SelectContent>
      </Select>
      {operand.type === 'field' ? (
        <Select value={operand.dimension} onValueChange={(d) => onChange({ type: 'field', dimension: d })}>
          <SelectTrigger aria-label="Operand field" className="h-7 flex-1 text-xs"><SelectValue placeholder="Field" /></SelectTrigger>
          <SelectContent>{dims.filter((d) => !numericOnly || d.kind === 'number').map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : operand.type === 'string' ? (
        <Input aria-label="Operand text" className="h-7 flex-1 text-xs" value={operand.value} onChange={(e) => onChange({ type: 'string', value: e.target.value })} />
      ) : (
        <Input aria-label="Operand number" type="number" className="h-7 flex-1 text-xs" value={operand.value} onChange={(e) => onChange({ type: 'number', value: Number(e.target.value) })} />
      )}
    </div>
  );
}

export function CustomColumnEditor({ dims, existing, onAdd, onCancel }: {
  dims: Dim[]; existing: CustomColumn[]; onAdd: (col: CustomColumn) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<'concat' | 'arithmetic'>('concat');
  const [parts, setParts] = useState<CustomColumnOperand[]>([defaultOperand('field')]);
  const [left, setLeft] = useState<CustomColumnOperand>(defaultOperand('field'));
  const [op, setOp] = useState<'+' | '-' | '*' | '/'>('+');
  const [right, setRight] = useState<CustomColumnOperand>(defaultOperand('number'));
  const [label, setLabel] = useState('');

  const dimLabel = (k: string) => dims.find((d) => d.key === k)?.label ?? k;
  const build = (): CustomColumnExpr =>
    kind === 'concat' ? { kind: 'concat', parts } : { kind: 'arithmetic', op, left, right };

  const operandOk = (o: CustomColumnOperand) => o.type !== 'field' || o.dimension !== '';
  const complete = kind === 'concat' ? parts.every(operandOk) : operandOk(left) && operandOk(right);

  const confirm = () => {
    const expr = build();
    onAdd({ key: uniqueCustomKey(existing), label: label || deriveCustomLabel(expr, dimLabel), expr });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
      <label>
        Operation
        <Select value={kind} onValueChange={(k) => setKind(k as 'concat' | 'arithmetic')}>
          <SelectTrigger aria-label="Operation" className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="concat">Concatenate (text)</SelectItem>
            <SelectItem value="arithmetic">Arithmetic (number)</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {kind === 'concat' ? (
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => (
            <OperandInput key={i} operand={p} dims={dims} allowString numericOnly={false} onChange={(o) => setParts(parts.map((x, j) => (j === i ? o : x)))} />
          ))}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => setParts([...parts, defaultOperand('field')])}>+ part</Button>
            {parts.length > 1 && (
              <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => setParts(parts.slice(0, -1))}>− part</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <OperandInput operand={left} dims={dims} allowString={false} numericOnly onChange={setLeft} />
          <Select value={op} onValueChange={(v) => setOp(v as '+' | '-' | '*' | '/')}>
            <SelectTrigger aria-label="Operator" className="h-7 w-14 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{['+', '-', '*', '/'].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <OperandInput operand={right} dims={dims} allowString={false} numericOnly onChange={setRight} />
        </div>
      )}

      <label>
        Label
        <Input aria-label="Custom column label" className="mt-1 h-8" placeholder="(auto)" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!complete} onClick={confirm}>Add column</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
