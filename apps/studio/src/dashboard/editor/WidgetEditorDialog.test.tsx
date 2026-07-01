import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { WidgetEditorDialog } from './WidgetEditorDialog';

afterEach(() => vi.restoreAllMocks());

describe('WidgetEditorDialog', () => {
  // The full save flow (which routes through the Radix ⋯ menu) is covered by the
  // Playwright check; jsdom can't reliably open Radix menus. Here we smoke-test that the
  // SQL editor mounts with its core controls.
  it('renders the SQL editor controls', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const { getByLabelText } = render(<WidgetEditorDialog open dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />);
    expect(getByLabelText('Title')).toBeTruthy();
    expect(getByLabelText('SQL')).toBeTruthy();
    expect(getByLabelText('Editor menu')).toBeTruthy();
    expect(getByLabelText('Close')).toBeTruthy();
  });
});
