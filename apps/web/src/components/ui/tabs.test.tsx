import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

describe('Tabs', () => {
  it('switches panels on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel-a</TabsContent>
        <TabsContent value="b">panel-b</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('panel-a')).toBeInTheDocument();
    // Radix Tabs activates its trigger on mousedown (primary button), not on a
    // synthetic click, so jsdom's fireEvent.click never reaches the handler.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('panel-b')).toBeInTheDocument();
  });
});
