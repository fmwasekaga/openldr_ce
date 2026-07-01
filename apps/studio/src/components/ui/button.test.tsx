import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders a button with its label', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });
  it('applies the ghost variant class', () => {
    render(<Button variant="ghost">G</Button>);
    expect(screen.getByRole('button', { name: 'G' }).className).toMatch(/hover:bg-accent/);
  });
  it('renders as a child element when asChild is set', () => {
    render(<Button asChild><a href="/x">link</a></Button>);
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
  });
});
