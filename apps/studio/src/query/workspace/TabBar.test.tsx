import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('disables the new-query button when nothing is queryable', () => {
    render(<TabBar canQuery={false} />);
    expect(screen.getByRole('button', { name: /new query/i })).toBeDisabled();
  });

  it('enables the new-query button when a source is available', () => {
    render(<TabBar canQuery />);
    expect(screen.getByRole('button', { name: /new query/i })).toBeEnabled();
  });
});
