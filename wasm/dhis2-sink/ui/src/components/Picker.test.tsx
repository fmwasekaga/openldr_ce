import { fireEvent, render, screen } from '@testing-library/preact';
import { Picker } from './Picker';

const options = [
  { value: 'ou1', label: 'Alpha Clinic' },
  { value: 'ou2', label: 'Beta Hospital' },
  { value: 'ou3', label: 'Gamma Health Post' },
];

describe('Picker', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(<Picker options={options} onChange={() => {}} placeholder="Pick one" testId="p" />);
    expect(screen.getByText('Pick one')).toBeTruthy();
  });

  it('shows the selected label', () => {
    render(<Picker options={options} value="ou2" onChange={() => {}} testId="p" />);
    expect(screen.getByText('Beta Hospital')).toBeTruthy();
  });

  it('filters options and fires onChange with the value on select', () => {
    const onChange = vi.fn();
    render(<Picker options={options} onChange={onChange} placeholder="Pick" testId="p" />);

    // Open the dropdown.
    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    // All three options visible.
    expect(screen.getAllByRole('option')).toHaveLength(3);

    // Filter narrows to one (case-insensitive substring).
    const search = screen.getByPlaceholderText('Search…') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'beta' } });
    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0].textContent).toContain('Beta Hospital');

    // Selecting fires onChange with the value, not the label.
    fireEvent.click(opts[0]);
    expect(onChange).toHaveBeenCalledWith('ou2');
  });

  it('shows a no-matches message when the filter excludes everything', () => {
    render(<Picker options={options} onChange={() => {}} placeholder="Pick" testId="p" />);
    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    fireEvent.input(screen.getByPlaceholderText('Search…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('does not open when disabled', () => {
    render(<Picker options={options} onChange={() => {}} placeholder="Pick" disabled testId="p" />);
    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
