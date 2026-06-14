import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';

function Harness({ onChange }: { onChange: (v: string) => void }) {
  return (
    <Select defaultValue="en" onValueChange={onChange}>
      <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="en">EN</SelectItem>
        <SelectItem value="fr">FR</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select', () => {
  it('shows the current value on the trigger', () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getByLabelText('Language')).toHaveTextContent('EN');
  });
  it('opens and selects an option', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Language'));
    fireEvent.click(screen.getByText('FR'));
    expect(onChange).toHaveBeenCalledWith('fr');
  });
});
