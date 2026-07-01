import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { LoopNode } from './loop-node';

describe('LoopNode', () => {
  it('renders a loop and a done source handle', () => {
    const { container } = render(
      <ReactFlowProvider>
        <LoopNode id="lp" type="loop" data={{ label: 'Loop', iterations: 3 }} selected={false}
          dragging={false} zIndex={0} isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
          draggable selectable deletable />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('[data-handleid="loop"]')).not.toBeNull();
    expect(container.querySelector('[data-handleid="done"]')).not.toBeNull();
  });
});
