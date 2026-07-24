import { describe, it, expect } from 'vitest';
import type { CapabilityGroup } from '@/api';
import {
  totalCapabilityCount, selectedCapabilityCount, toggleCapability,
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

  it('toggleCapability adds an absent key and removes a present one, without mutating the input', () => {
    const original = new Set(['users.view']);
    const added = toggleCapability(original, 'roles.view');
    expect(added.has('roles.view')).toBe(true);
    expect(original.has('roles.view')).toBe(false); // input untouched

    const removed = toggleCapability(added, 'roles.view');
    expect(removed.has('roles.view')).toBe(false);
  });
});
