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
  it('displays current language as a badge', () => {
    renderControl(['fr']);
    expect(screen.getByText('fr')).toBeTruthy();
  });

  it('displays multiple current languages as badges', () => {
    renderControl(['fr', 'pt']);
    expect(screen.getByText('fr')).toBeTruthy();
    expect(screen.getByText('pt')).toBeTruthy();
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

  it('calls onChange without removed language when clicking remove on a badge', () => {
    const { onChange } = renderControl(['fr']);
    const removeBtn = screen.getByRole('button', { name: 'Remove fr' });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('removing one of multiple languages leaves the others', () => {
    const { onChange } = renderControl(['fr', 'pt']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove fr' }));
    expect(onChange).toHaveBeenCalledWith(['pt']);
  });
});
