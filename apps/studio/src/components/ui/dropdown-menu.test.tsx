import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from './dropdown-menu';

describe('DropdownMenu', () => {
  it('opens and fires an item click', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Item A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // Radix opens on pointerdown (primary mouse button), not synthetic click,
    // under jsdom. Drive the open with explicit pointer events, then the
    // keyboard fallback (Enter) which Radix also honours on the trigger.
    const trigger = screen.getByText('Menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Item A')) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    const item = screen.getByText('Item A');
    fireEvent.pointerMove(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
  });
});
