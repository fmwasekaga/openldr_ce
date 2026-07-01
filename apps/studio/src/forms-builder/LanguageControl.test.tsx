import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageControl } from './LanguageControl';

function renderControl(
  languages: string[],
  onChange = vi.fn(),
) {
  const utils = render(
    <LanguageControl languages={languages} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

describe('LanguageControl', () => {
  it('shows 0 on the globe trigger when no languages are selected', () => {
    renderControl([]);
    expect(screen.getByRole('button', { name: 'Languages' })).toHaveTextContent('0');
  });

  it('shows the selected count on the globe trigger', () => {
    renderControl(['fr']);
    expect(screen.getByRole('button', { name: 'Languages' })).toHaveTextContent('1');
  });

  it('shows the count for multiple selected languages', () => {
    renderControl(['fr', 'pt']);
    expect(screen.getByRole('button', { name: 'Languages' })).toHaveTextContent('2');
  });

  it('opens popover on globe button click and lists available languages', () => {
    renderControl(['fr']);
    const trigger = screen.getByRole('button', { name: 'Languages' });
    fireEvent.click(trigger);
    // 'pt' and 'es' should be available (not already selected)
    expect(screen.getByRole('button', { name: /Add pt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add es/ })).toBeTruthy();
    // 'fr' should not be in the add list (already selected)
    expect(screen.queryByRole('button', { name: /Add fr/ })).toBeNull();
  });

  it('calls onChange with new language added when selecting from popover', () => {
    const { onChange } = renderControl(['fr']);
    const trigger = screen.getByRole('button', { name: 'Languages' });
    fireEvent.click(trigger);
    const ptButton = screen.getByRole('button', { name: /Add pt/ });
    fireEvent.click(ptButton);
    expect(onChange).toHaveBeenCalledWith(['fr', 'pt']);
  });

  it('calls onChange without the removed language when removing from the popover', () => {
    const { onChange } = renderControl(['fr']);
    fireEvent.click(screen.getByRole('button', { name: 'Languages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove fr' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('removing one of multiple languages leaves the others', () => {
    const { onChange } = renderControl(['fr', 'pt']);
    fireEvent.click(screen.getByRole('button', { name: 'Languages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove fr' }));
    expect(onChange).toHaveBeenCalledWith(['pt']);
  });
});
