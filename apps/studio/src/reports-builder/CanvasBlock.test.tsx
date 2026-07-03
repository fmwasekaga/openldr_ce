import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasBlock } from './CanvasBlock';

describe('CanvasBlock', () => {
  it('renders title text', () => {
    render(<CanvasBlock block={{ kind: 'title', text: 'Hello', style: { fontSize: 16 } } as never} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('renders a chart placeholder labelled by chart type', () => {
    render(<CanvasBlock block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} />);
    expect(screen.getByText(/bar chart/i)).toBeInTheDocument();
  });
  it('renders a table placeholder', () => {
    render(<CanvasBlock block={{ kind: 'table', source: 'primary', columns: [] } as never} />);
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });
});
