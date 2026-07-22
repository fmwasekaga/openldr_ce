import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FilterConditionEditor } from './FilterConditionEditor';
import type { ModelDimension } from '../../api';

const dims: ModelDimension[] = [
  { key: 'status', label: 'Status', column: 'status', kind: 'string' },
  { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
];

describe('FilterConditionEditor', () => {
  // shadcn/Radix Select isn't reliably drivable via jsdom fireEvent (see
  // WidgetEditorDialog.test.tsx); behavior lives in conditionModel.test.ts's pure-function
  // tests. This is a render smoke-test only.
  it('renders just the add-filter control when there are no conditions', () => {
    const { getByRole, queryByLabelText } = render(<FilterConditionEditor value={[]} dimensions={dims} onChange={vi.fn()} />);
    expect(getByRole('button', { name: /add filter/i })).toBeTruthy();
    expect(queryByLabelText('Filter field')).toBeNull();
    expect(queryByLabelText('Filter operator')).toBeNull();
  });

  it('renders field/operator controls and a remove button for an existing condition', () => {
    const { getByLabelText, getByRole } = render(
      <FilterConditionEditor value={[{ dimension: 'status', op: 'eq', value: '' }]} dimensions={dims} onChange={vi.fn()} />,
    );
    expect(getByLabelText('Filter field')).toBeTruthy();
    expect(getByLabelText('Filter operator')).toBeTruthy();
    expect(getByRole('button', { name: /remove filter/i })).toBeTruthy();
  });
});
