import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UserJoinBuilder } from './UserJoinBuilder';

const joinable = [
  { table: 'patients', label: 'Patient', columns: ['sex', 'managing_organization'], primaryKeys: ['id'], allColumns: ['id', 'patient_id', 'sex', 'managing_organization', 'national_id'] },
];
const baseColumns = ['id', 'patient_id', 'status'];
const join = { id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' };

describe('UserJoinBuilder', () => {
  it('renders the on-clause keys and the column checklist', () => {
    render(<UserJoinBuilder join={join} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={() => {}} onRemove={() => {}} />);
    // Exact match: a loose /on/i regex also matches the "managing_organization" checkbox label.
    expect(screen.getByText('on', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('sex')).toBeInTheDocument();
  });

  it('warns when the right key is not a primary key', () => {
    const nonPk = { ...join, right: 'patient_id' }; // not in primaryKeys(['id'])
    render(<UserJoinBuilder join={nonPk} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/may inflate/i)).toBeInTheDocument();
  });

  it('emits column selection via onColumns', () => {
    const onColumns = vi.fn();
    render(<UserJoinBuilder join={join} joinable={joinable} baseColumns={baseColumns} selected={[]} onChange={() => {}} onColumns={onColumns} onRemove={() => {}} />);
    fireEvent.click(screen.getByLabelText('sex'));
    expect(onColumns).toHaveBeenCalledWith('u1', ['sex']);
  });
});
