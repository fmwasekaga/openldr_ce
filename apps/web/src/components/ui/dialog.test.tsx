import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from './dialog';

describe('Dialog', () => {
  it('opens on trigger click and shows content', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent><DialogTitle>Hi</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText('Hi')).toBeNull();
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });
});
