import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table';

describe('Table', () => {
  it('renders a semantic table with header and cells', () => {
    render(
      <Table>
        <TableHeader><TableRow><TableHead>Col</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>Val</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Col' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Val' })).toBeInTheDocument();
  });
});
