import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

describe('ConfirmDialog', () => {
  it('renders the title when open', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Are you sure?"
        confirmLabel="Confirm"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete item"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onConfirm when the action button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Proceed?"
        confirmLabel="Yes, proceed"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText('Yes, proceed'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders the cancel button with default label', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        confirmLabel="OK"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders custom cancel label', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        confirmLabel="OK"
        cancelLabel="Go back"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Go back')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('renders the trigger text', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>hi</TooltipTrigger>
          <TooltipContent>tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText('hi')).toBeInTheDocument();
  });
});
