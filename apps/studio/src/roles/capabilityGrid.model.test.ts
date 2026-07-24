import { describe, it, expect } from 'vitest';
import type { CapabilityGroup } from '@/api';
import {
  totalCapabilityCount, selectedCapabilityCount, groupSelectedCount,
  isGroupFullySelected, isGroupPartiallySelected, isAllSelected,
  toggleCapability, setGroupSelected, setAllSelected,
} from './capabilityGrid.model';

const groups: CapabilityGroup[] = [
  {
    key: 'users', label: 'Users',
    capabilities: [
      { key: 'users.view', group: 'users', label: 'View users', description: 'See the user list' },
      { key: 'users.manage', group: 'users', label: 'Manage users', description: 'Create/edit/delete users' },
    ],
  },
  {
    key: 'roles', label: 'Roles',
    capabilities: [
      { key: 'roles.view', group: 'roles', label: 'View roles', description: 'See roles' },
      { key: 'roles.manage', group: 'roles', label: 'Manage roles', description: 'Create/edit/delete roles' },
      { key: 'roles.assign', group: 'roles', label: 'Assign roles', description: 'Assign roles to users' },
    ],
  },
];

describe('capabilityGrid.model', () => {
  it('totalCapabilityCount sums across all groups', () => {
    expect(totalCapabilityCount(groups)).toBe(5);
  });

  it('totalCapabilityCount is 0 for no groups', () => {
    expect(totalCapabilityCount([])).toBe(0);
  });

  it('selectedCapabilityCount counts only keys present in selected', () => {
    const selected = new Set(['users.view', 'roles.manage', 'unknown.key']);
    expect(selectedCapabilityCount(groups, selected)).toBe(2);
  });

  it('groupSelectedCount scopes to one group', () => {
    const selected = new Set(['users.view', 'roles.manage', 'roles.assign']);
    expect(groupSelectedCount(groups[0], selected)).toBe(1);
    expect(groupSelectedCount(groups[1], selected)).toBe(2);
  });

  it('isGroupFullySelected true only when every capability in the group is selected', () => {
    const none = new Set<string>();
    const partial = new Set(['users.view']);
    const full = new Set(['users.view', 'users.manage']);
    expect(isGroupFullySelected(groups[0], none)).toBe(false);
    expect(isGroupFullySelected(groups[0], partial)).toBe(false);
    expect(isGroupFullySelected(groups[0], full)).toBe(true);
  });

  it('isGroupFullySelected is false for an empty group (never vacuously true)', () => {
    const empty: CapabilityGroup = { key: 'empty', label: 'Empty', capabilities: [] };
    expect(isGroupFullySelected(empty, new Set())).toBe(false);
  });

  it('isGroupPartiallySelected true only for a strict subset', () => {
    expect(isGroupPartiallySelected(groups[0], new Set())).toBe(false);
    expect(isGroupPartiallySelected(groups[0], new Set(['users.view']))).toBe(true);
    expect(isGroupPartiallySelected(groups[0], new Set(['users.view', 'users.manage']))).toBe(false);
  });

  it('isAllSelected requires every group fully selected', () => {
    const allKeys = groups.flatMap((g) => g.capabilities.map((c) => c.key));
    expect(isAllSelected(groups, new Set(allKeys))).toBe(true);
    expect(isAllSelected(groups, new Set(allKeys.slice(1)))).toBe(false);
    expect(isAllSelected([], new Set())).toBe(false);
  });

  it('toggleCapability adds an absent key and removes a present one, without mutating the input', () => {
    const original = new Set(['users.view']);
    const added = toggleCapability(original, 'roles.view');
    expect(added.has('roles.view')).toBe(true);
    expect(original.has('roles.view')).toBe(false); // input untouched

    const removed = toggleCapability(added, 'roles.view');
    expect(removed.has('roles.view')).toBe(false);
  });

  it('setGroupSelected(checked=true) adds every capability in the group and leaves others alone', () => {
    const original = new Set(['roles.view']);
    const next = setGroupSelected(original, groups[0], true);
    expect([...next].sort()).toEqual(['roles.view', 'users.manage', 'users.view'].sort());
    expect(original.has('users.view')).toBe(false); // input untouched
  });

  it('setGroupSelected(checked=false) removes every capability in the group and leaves others alone', () => {
    const original = new Set(['users.view', 'users.manage', 'roles.view']);
    const next = setGroupSelected(original, groups[0], false);
    expect([...next].sort()).toEqual(['roles.view']);
  });

  it('setAllSelected(checked=true) selects every capability across every group', () => {
    const next = setAllSelected(groups, new Set(), true);
    expect(next.size).toBe(5);
    expect(isAllSelected(groups, next)).toBe(true);
  });

  it('setAllSelected(checked=false) clears every group capability but leaves unrelated keys', () => {
    const original = new Set(['users.view', 'roles.manage', 'unrelated.key']);
    const next = setAllSelected(groups, original, false);
    expect([...next]).toEqual(['unrelated.key']);
  });
});
