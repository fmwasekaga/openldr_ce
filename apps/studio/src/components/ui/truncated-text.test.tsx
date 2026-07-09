import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TruncatedText } from './truncated-text';

/**
 * jsdom performs no layout, so scrollWidth/clientWidth are always 0 on every
 * element. Mock them on HTMLElement.prototype for the duration of a test to
 * simulate a clipped ("scrollWidth > clientWidth") or fitting element.
 */
function mockWidths(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: clientWidth });
}

afterEach(() => {
  // Restore jsdom's real (always-zero) getters so other tests aren't affected.
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

describe('TruncatedText', () => {
  it('renders plain text with no tooltip when the text fits (scrollWidth <= clientWidth)', () => {
    mockWidths(100, 100);
    render(<TruncatedText text="Short label" />);
    expect(screen.getByText('Short label')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Focusing the element (which would open a Radix tooltip trigger, if wrapped)
    // must not surface a tooltip since the text isn't clipped.
    fireEvent.focus(screen.getByText('Short label'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a tooltip with the full text when the text is clipped (scrollWidth > clientWidth)', async () => {
    mockWidths(300, 100);
    render(<TruncatedText text="A very long label that definitely overflows its container" />);
    const trigger = screen.getByText('A very long label that definitely overflows its container');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('A very long label that definitely overflows its container');
  });

  it('re-measures when the text prop changes', () => {
    mockWidths(100, 100);
    const { rerender } = render(<TruncatedText text="Fits" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    mockWidths(300, 100);
    rerender(<TruncatedText text="Now this one is much longer and overflows" />);
    fireEvent.focus(screen.getByText('Now this one is much longer and overflows'));
    return screen.findByRole('tooltip').then((tooltip) => {
      expect(tooltip).toHaveTextContent('Now this one is much longer and overflows');
    });
  });
});
