import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { RuleValueEditor } from './RuleValueEditor';

const params = [{ id: 'site', label: 'Site', type: 'text' as const, required: false }];

describe('RuleValueEditor', () => {
  it('edits a literal value', () => {
    const onChange = vi.fn();
    render(<RuleValueEditor op="eq" value="" parameters={[]} onChange={onChange} idPrefix="r0" />);
    fireEvent.change(screen.getByLabelText('r0-value'), { target: { value: 'completed' } });
    expect(onChange).toHaveBeenCalledWith('completed');
  });

  it('switches to param mode and emits a {{param.id}} token', () => {
    const onChange = vi.fn();
    render(<RuleValueEditor op="eq" value="" parameters={params} onChange={onChange} idPrefix="r0" />);
    fireEvent.click(screen.getByLabelText('r0-mode-param'));
    expect(onChange).toHaveBeenCalledWith('{{param.site}}');
  });
});
