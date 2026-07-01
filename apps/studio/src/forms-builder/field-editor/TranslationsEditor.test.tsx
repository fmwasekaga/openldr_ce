import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';
import { TranslationsEditor } from './TranslationsEditor';

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'text',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
  translations: {
    fr: { label: 'Nom' },
  },
};

function renderEditor(
  overrides: Partial<Parameters<typeof TranslationsEditor>[0]> = {},
) {
  const onUpdate = vi.fn();
  const utils = render(
    <TranslationsEditor
      field={BASE_FIELD}
      languages={['fr', 'pt']}
      onUpdate={onUpdate}
      {...overrides}
    />,
  );
  return { ...utils, onUpdate };
}

describe('TranslationsEditor', () => {
  describe('renders translation inputs', () => {
    it('renders a label input for each language', () => {
      renderEditor();
      // fr and pt each get an input
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it('shows the existing fr label value', () => {
      renderEditor();
      const frInput = screen.getByRole('textbox', { name: /fr label/i });
      expect((frInput as HTMLInputElement).value).toBe('Nom');
    });

    it('shows an empty input for pt (no existing translation)', () => {
      renderEditor();
      const ptInput = screen.getByRole('textbox', { name: /pt label/i });
      expect((ptInput as HTMLInputElement).value).toBe('');
    });
  });

  describe('updating translations', () => {
    it('calls onUpdate with immutably merged translations when pt label is typed', () => {
      const { onUpdate } = renderEditor();
      const ptInput = screen.getByRole('textbox', { name: /pt label/i });
      fireEvent.change(ptInput, { target: { value: 'Nome' } });
      expect(onUpdate).toHaveBeenCalledWith({
        translations: {
          fr: { label: 'Nom' },
          pt: { label: 'Nome' },
        },
      });
    });

    it('calls onUpdate preserving existing locale data when updating fr label', () => {
      const { onUpdate } = renderEditor({
        field: {
          ...BASE_FIELD,
          translations: {
            fr: { label: 'Nom', description: 'desc fr' },
          },
        },
      });
      const frInput = screen.getByRole('textbox', { name: /fr label/i });
      fireEvent.change(frInput, { target: { value: 'Prénom' } });
      expect(onUpdate).toHaveBeenCalledWith({
        translations: {
          fr: { label: 'Prénom', description: 'desc fr' },
        },
      });
    });
  });

  describe('empty state', () => {
    it('shows the empty-state message when languages is empty', () => {
      renderEditor({ languages: [] });
      expect(
        screen.getByText(
          'No translation languages yet. Add one with the language control in the form header.',
        ),
      ).toBeTruthy();
    });

    it('renders no inputs when languages is empty', () => {
      renderEditor({ languages: [] });
      expect(screen.queryAllByRole('textbox').length).toBe(0);
    });
  });
});
