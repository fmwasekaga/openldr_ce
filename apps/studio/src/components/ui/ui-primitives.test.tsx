import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Badge } from './badge';
import { Checkbox } from './checkbox';
import { TablePagination } from './table-pagination';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from './alert-dialog';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies secondary variant class', () => {
    render(<Badge variant="secondary">Draft</Badge>);
    const el = screen.getByText('Draft');
    expect(el.className).toMatch(/bg-muted/);
  });

  it('allows className override', () => {
    render(<Badge className="custom-cls">X</Badge>);
    expect(screen.getByText('X').className).toMatch(/custom-cls/);
  });
});

describe('Checkbox', () => {
  it('fires onCheckedChange when clicked', () => {
    const handler = vi.fn();
    render(<Checkbox onCheckedChange={handler} />);
    const cb = screen.getByRole('checkbox');
    fireEvent.click(cb);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('is disabled when disabled prop set', () => {
    render(<Checkbox disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe('TablePagination', () => {
  function setup(overrides: Partial<Parameters<typeof TablePagination>[0]> = {}) {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <TablePagination
        page={0}
        pageSize={10}
        total={50}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        {...overrides}
      />,
    );
    return { onPageChange, onPageSizeChange };
  }

  it('shows the "of N" label', () => {
    setup();
    expect(screen.getByText(/of 50/)).toBeInTheDocument();
  });

  it('shows correct from–to range on page 0', () => {
    setup();
    expect(screen.getByText(/1–10 of 50/)).toBeInTheDocument();
  });

  it('Prev button is disabled on page 0', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('Next button is enabled when more pages remain', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Next page' })).not.toBeDisabled();
  });

  it('Next button is disabled on the last page', () => {
    setup({ page: 4, pageSize: 10, total: 50 });
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('calls onPageChange(1) when Next is clicked', () => {
    const { onPageChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('renders leftSlot content', () => {
    setup({ leftSlot: <span>Filters</span> });
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });
});

describe('AlertDialog', () => {
  it('renders title text when open', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByText('Delete item?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });
});
