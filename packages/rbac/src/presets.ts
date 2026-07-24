import { CAPABILITY_KEYS } from './catalog';

export interface SystemRoleDef {
  slug: string;
  name: string;
  description: string;
  locked: boolean;
  capabilities: string[];
}

const MANAGER = [
  'dashboards.view', 'dashboards.create', 'dashboards.edit', 'dashboards.delete',
  'reports.view', 'reports.run', 'reports.export', 'reports.edit_templates',
  'forms.view', 'forms.edit', 'forms.publish',
  'workflows.view', 'workflows.edit', 'workflows.run', 'workflows.manage_secrets',
  'query.run',
  'terminology.view', 'terminology.manage',
  'activity.view', 'notifications.view',
];

const ANALYST = [
  'dashboards.view',
  'reports.view', 'reports.run', 'reports.export',
  'forms.view',
  'query.run',
  'terminology.view',
  'activity.view', 'notifications.view',
];

const AUDITOR = [
  'dashboards.view',
  'reports.view',
  'forms.view',
  'terminology.view',
  'activity.view', 'notifications.view',
  'audit.view',
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { slug: 'lab_admin', name: 'Administrator', description: 'Full access to every capability.', locked: true, capabilities: [...CAPABILITY_KEYS] },
  { slug: 'lab_manager', name: 'Lab Manager', description: 'Manage content and analytics; no admin, users, or settings.', locked: false, capabilities: MANAGER },
  { slug: 'data_analyst', name: 'Data Analyst', description: 'View dashboards, run and export reports, use the query workbench.', locked: false, capabilities: ANALYST },
  { slug: 'system_auditor', name: 'System Auditor', description: 'Read-only oversight plus the audit log.', locked: false, capabilities: AUDITOR },
  { slug: 'lab_technician', name: 'Lab Technician', description: 'Bench data entry — fill and submit forms only.', locked: false, capabilities: ['forms.view'] },
];
