export interface CapabilityMeta {
  key: string;
  group: string;
  label: string;
  description: string;
}
export interface CapabilityGroup {
  key: string;
  label: string;
  capabilities: CapabilityMeta[];
}

// One row per capability. `group` matches a CAPABILITY_GROUPS key. Order within a
// group is the display order in the builder grid. Keep keys stable — they are
// persisted in role_capabilities and referenced by requireCapability(...).
const RAW: Omit<CapabilityMeta, never>[] = [
  // Dashboards
  { key: 'dashboards.view', group: 'dashboards', label: 'View dashboards', description: 'Open the Dashboards workspace and see activity widgets.' },
  { key: 'dashboards.create', group: 'dashboards', label: 'Create dashboards', description: 'Add new dashboards.' },
  { key: 'dashboards.edit', group: 'dashboards', label: 'Edit dashboards', description: 'Modify dashboard layout and widgets.' },
  { key: 'dashboards.delete', group: 'dashboards', label: 'Delete dashboards', description: 'Remove dashboards.' },
  // Reports
  { key: 'reports.view', group: 'reports', label: 'View reports', description: 'Open the Reports workspace and see report definitions.' },
  { key: 'reports.run', group: 'reports', label: 'Run reports', description: 'Execute and preview reports.' },
  { key: 'reports.export', group: 'reports', label: 'Export reports', description: 'Download report output (PDF/data).' },
  { key: 'reports.edit_templates', group: 'reports', label: 'Edit report templates', description: 'Create and edit report definitions, categories, and designs.' },
  // Forms
  { key: 'forms.view', group: 'forms', label: 'Use forms', description: 'Open and submit forms (data entry).' },
  { key: 'forms.edit', group: 'forms', label: 'Edit forms', description: 'Create and modify form definitions; export form bundles.' },
  { key: 'forms.publish', group: 'forms', label: 'Publish forms', description: 'Publish new form versions.' },
  // Workflows
  { key: 'workflows.view', group: 'workflows', label: 'View workflows', description: 'Open the Workflows workspace and see definitions and runs.' },
  { key: 'workflows.edit', group: 'workflows', label: 'Edit workflows', description: 'Create and modify workflow definitions.' },
  { key: 'workflows.run', group: 'workflows', label: 'Run workflows', description: 'Trigger workflow executions.' },
  { key: 'workflows.manage_secrets', group: 'workflows', label: 'Manage workflow secrets', description: 'View and set encrypted workflow secrets.' },
  // Query
  { key: 'query.run', group: 'query', label: 'Use query workbench', description: 'Run ad-hoc SQL queries against analytics data.' },
  // Users
  { key: 'users.view', group: 'users', label: 'View users', description: 'Open the Users workspace and see accounts.' },
  { key: 'users.manage', group: 'users', label: 'Manage users', description: 'Create, edit, enable, and disable user accounts.' },
  { key: 'users.reset_password', group: 'users', label: 'Reset passwords', description: "Reset a user's password or send a reset email." },
  { key: 'users.force_logout', group: 'users', label: 'Force logout', description: 'End all of a user’s active sessions.' },
  // Roles
  { key: 'roles.view', group: 'roles', label: 'View roles', description: 'Open the Roles workspace and see roles and their capabilities.' },
  { key: 'roles.manage', group: 'roles', label: 'Manage roles', description: 'Create, edit, delete roles and assign them to users.' },
  // Terminology
  { key: 'terminology.view', group: 'terminology', label: 'Browse terminology', description: 'Browse coding systems, value sets, and mappings.' },
  { key: 'terminology.manage', group: 'terminology', label: 'Manage terminology', description: 'Import, edit, and build terminology and ontologies.' },
  // Marketplace
  { key: 'marketplace.view', group: 'marketplace', label: 'View marketplace', description: 'Browse available and installed plugins.' },
  { key: 'marketplace.manage', group: 'marketplace', label: 'Manage marketplace', description: 'Install, publish, enable, disable, and remove plugins and registries.' },
  // Connectors
  { key: 'connectors.manage', group: 'connectors', label: 'Manage connectors', description: 'Configure external database and service connectors.' },
  // Sync
  { key: 'sync.view', group: 'sync', label: 'View sync', description: 'See lab⇄central sync status and activity.' },
  { key: 'sync.manage', group: 'sync', label: 'Manage sync', description: 'Configure sync, enroll sites, and resolve divergences.' },
  // Settings
  { key: 'settings.view', group: 'settings', label: 'View settings', description: 'Open the Settings workspace.' },
  { key: 'settings.edit_general', group: 'settings', label: 'Edit general settings', description: 'Change general, number, and validation settings.' },
  { key: 'settings.feature_flags', group: 'settings', label: 'Manage feature flags', description: 'Toggle feature flags.' },
  { key: 'settings.danger_zone', group: 'settings', label: 'Danger zone', description: 'Run destructive maintenance actions.' },
  // Observability
  { key: 'activity.view', group: 'observability', label: 'View activity', description: 'See the payload-lifecycle activity feed.' },
  { key: 'notifications.view', group: 'observability', label: 'View notifications', description: 'Receive notifications and set preferences.' },
  // Audit
  { key: 'audit.view', group: 'audit', label: 'View audit log', description: 'Read the audit event log.' },
];

const GROUP_LABELS: Record<string, string> = {
  dashboards: 'Dashboards',
  reports: 'Reports',
  forms: 'Forms',
  workflows: 'Workflows',
  query: 'Query',
  users: 'Users',
  roles: 'Roles',
  terminology: 'Terminology',
  marketplace: 'Marketplace',
  connectors: 'Connectors',
  sync: 'Sync',
  settings: 'Settings',
  observability: 'Observability',
  audit: 'Audit',
};

export const CAPABILITIES: CapabilityMeta[] = RAW;
export const CAPABILITY_KEYS: readonly string[] = RAW.map((c) => c.key);

// Preserve first-seen group order from RAW.
const _order: string[] = [];
for (const c of RAW) if (!_order.includes(c.group)) _order.push(c.group);
export const CAPABILITY_GROUPS: CapabilityGroup[] = _order.map((g) => ({
  key: g,
  label: GROUP_LABELS[g] ?? g,
  capabilities: RAW.filter((c) => c.group === g),
}));

export function isCapabilityKey(k: string): boolean {
  return CAPABILITY_KEYS.includes(k);
}
