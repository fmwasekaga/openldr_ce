import { DOCS_VERSION, compareVersions } from './version';

export type Locale = 'en' | 'fr' | 'pt';
export const LOCALES: Locale[] = ['en', 'fr', 'pt'];

export type DocGroupId = 'start' | 'daily-work' | 'data-design' | 'administration' | 'more';
export type DocAudience = 'all-users' | 'lab-users' | 'lab-managers' | 'administrators';
export type DocDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type DocStatus = 'published' | 'coming-soon';

export interface DocGroup {
  id: DocGroupId;
  title: string;
}

export interface DocGuide {
  slug: string;
  title: string;
  group: DocGroupId;
  summary: string;
  audience: DocAudience[];
  requiredRoles: string[];
  estimatedMinutes: number;
  difficulty: DocDifficulty;
  relatedSlugs: string[];
  screenshotNames: string[];
  status: DocStatus;
}

export interface DocSection extends DocGuide {
  content: string;
  localeUsed: Locale;
}

export const DOC_GROUPS: DocGroup[] = [
  { id: 'start', title: 'Start here' },
  { id: 'daily-work', title: 'Daily work' },
  { id: 'data-design', title: 'Data and design' },
  { id: 'administration', title: 'Administration' },
  { id: 'more', title: 'More' },
];

export const DOC_GUIDES: DocGuide[] = [
  {
    slug: 'start-here',
    title: 'Start Here',
    group: 'start',
    summary: 'Learn the main navigation and complete a short first-use path.',
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 8,
    difficulty: 'beginner',
    relatedSlugs: ['dashboard', 'reports', 'advanced-docs'],
    screenshotNames: ['start-here-navigation.png'],
    status: 'published',
  },
  {
    slug: 'dashboard',
    title: 'Dashboard',
    group: 'daily-work',
    summary: 'Read dashboards, apply filters, and configure widgets.',
    audience: ['all-users', 'lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'beginner',
    relatedSlugs: ['reports', 'workflows'],
    screenshotNames: ['dashboard-overview.png', 'dashboard-edit-widget.png'],
    status: 'published',
  },
  {
    slug: 'reports',
    title: 'Reports',
    group: 'daily-work',
    summary: 'Run reports, interpret results, export output, and review activity.',
    audience: ['lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 12,
    difficulty: 'beginner',
    relatedSlugs: ['dashboard', 'audit', 'report-designer', 'query'],
    screenshotNames: ['reports-run-result.png', 'reports-history-schedules.png'],
    status: 'published',
  },
  {
    slug: 'workflows',
    title: 'Workflows',
    group: 'data-design',
    summary: 'Create, run, and troubleshoot data workflows in the visual builder.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    relatedSlugs: ['report-pipeline', 'reports', 'connectors', 'audit'],
    screenshotNames: ['workflows-list.png', 'workflow-builder.png', 'workflow-run-history.png'],
    status: 'published',
  },
  {
    slug: 'report-pipeline',
    title: 'Scheduled reports with workflows',
    group: 'data-design',
    summary: 'Query a database on a schedule, fill an Excel template, and email the report — with two workflows.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['workflows', 'connectors', 'reports'],
    screenshotNames: ['report-materialize-builder.png', 'report-excel-template.png'],
    status: 'published',
  },
  {
    slug: 'query',
    title: 'Custom Queries',
    group: 'data-design',
    summary: 'Explore connectors and write parameterized SQL queries that power report templates.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager', 'data_analyst'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['reports', 'report-designer', 'connectors'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'report-designer',
    title: 'Report Designer',
    group: 'data-design',
    summary: 'Design printable report templates, bind tables to queries, and publish them as reports.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: ['lab_admin', 'lab_manager'],
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    relatedSlugs: ['reports', 'query', 'connectors'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'forms',
    title: 'Forms',
    group: 'data-design',
    summary: 'Build, publish, and use forms for structured data capture.',
    audience: ['lab-users', 'lab-managers'],
    requiredRoles: [],
    estimatedMinutes: 18,
    difficulty: 'intermediate',
    relatedSlugs: ['terminology', 'marketplace'],
    screenshotNames: ['forms-list.png', 'form-builder.png', 'form-capture.png'],
    status: 'published',
  },
  {
    slug: 'terminology',
    title: 'Terminology',
    group: 'data-design',
    summary: 'Browse code systems and import terms, ValueSets, and ontology indexes.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['forms', 'audit'],
    screenshotNames: ['terminology-overview.png', 'terminology-import.png'],
    status: 'published',
  },
  {
    slug: 'users',
    title: 'Users and Roles',
    group: 'administration',
    summary: 'Manage user access, roles, account state, and feature visibility.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 12,
    difficulty: 'intermediate',
    relatedSlugs: ['audit', 'settings'],
    screenshotNames: ['users-list.png', 'user-edit-roles.png'],
    status: 'published',
  },
  {
    slug: 'audit',
    title: 'Audit',
    group: 'administration',
    summary: 'Filter audit events and investigate user-visible changes.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 10,
    difficulty: 'intermediate',
    relatedSlugs: ['users', 'workflows'],
    screenshotNames: ['audit-filter.png', 'audit-event-detail.png'],
    status: 'published',
  },
  {
    slug: 'settings',
    title: 'Settings',
    group: 'administration',
    summary: 'Understand administrator settings and find focused configuration guides.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 5,
    difficulty: 'beginner',
    relatedSlugs: ['connectors', 'marketplace', 'environment'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'connectors',
    title: 'Connectors',
    group: 'administration',
    summary: 'Create, test, secure, and maintain external-system connectors.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['report-pipeline', 'settings', 'workflows', 'marketplace', 'query'],
    screenshotNames: ['connectors-list.png', 'connector-form.png'],
    status: 'published',
  },
  {
    slug: 'marketplace',
    title: 'Marketplace',
    group: 'administration',
    summary: 'Browse, install, configure, update, and remove supported artifacts.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 15,
    difficulty: 'intermediate',
    relatedSlugs: ['settings', 'connectors', 'forms'],
    screenshotNames: [
      'marketplace-browse.png',
      'marketplace-detail.png',
      'marketplace-registries.png',
    ],
    status: 'published',
  },
  {
    slug: 'environment',
    title: 'Environment Variables',
    group: 'administration',
    summary: 'Reference for the environment variables that configure a deployment.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    estimatedMinutes: 8,
    difficulty: 'advanced',
    relatedSlugs: ['settings', 'connectors'],
    screenshotNames: [],
    status: 'published',
  },
  {
    slug: 'advanced-docs',
    title: 'Deployment & Developer Docs',
    group: 'more',
    summary: 'Find deployment, configuration, CLI, and developer docs on the OpenLDR website.',
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 3,
    difficulty: 'advanced',
    relatedSlugs: ['start-here', 'settings'],
    screenshotNames: [],
    status: 'published',
  },
];

/** Navigation order; pages without authored markdown are omitted by list(). */
export const DOC_ORDER = DOC_GUIDES.map((guide) => guide.slug);

// Eagerly bundle every locale's markdown. Path shape: ./0.1.0/<locale>/<slug>.md
const files = import.meta.glob('./0.1.0/*/*.md', {
  query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

// BY_VERSION[version][locale][slug] = content
const BY_VERSION: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, content] of Object.entries(files)) {
  const match = path.match(/\.\/([^/]+)\/([^/]+)\/([^/]+)\.md$/);
  if (!match) continue;
  const [, version, locale, slug] = match;
  ((BY_VERSION[version] ??= {})[locale] ??= {})[slug] = content;
}

export function firstHeading(md: string): string {
  const line = md.split('\n').find((candidate) => /^#\s+/.test(candidate.trim()));
  return line ? line.trim().replace(/^#\s+/, '').trim() : '';
}

/** Authored doc versions, newest first (discovered from the content folders). */
export const DOC_VERSIONS: string[] = Object.keys(BY_VERSION).sort((a, b) =>
  compareVersions(b, a),
);

/** The version to show by default: this release if it has authored docs, else the
 * newest authored version (so a release ahead of its docs still shows the latest). */
export const DEFAULT_DOC_VERSION: string =
  DOC_VERSIONS.find((version) => version === DOCS_VERSION) ?? DOC_VERSIONS[0] ?? DOCS_VERSION;

function localesForVersion(version: string): Record<string, Record<string, string>> {
  if (BY_VERSION[version]) return BY_VERSION[version];
  return BY_VERSION[DOC_VERSIONS[0]] ?? {};
}

export function resolve(
  locale: Locale,
  slug: string,
  version: string = DEFAULT_DOC_VERSION,
): DocSection | null {
  const guide = DOC_GUIDES.find((candidate) => candidate.slug === slug);
  if (!guide) return null;

  const locales = localesForVersion(version);
  const localized = locales[locale]?.[slug];
  const content = localized ?? locales.en?.[slug];
  if (content == null) return null;

  return {
    ...guide,
    title: firstHeading(content) || guide.title,
    content,
    localeUsed: localized != null ? locale : 'en',
  };
}

export function list(locale: Locale, version: string = DEFAULT_DOC_VERSION): DocSection[] {
  return DOC_GUIDES
    .map((guide) => resolve(locale, guide.slug, version))
    .filter((section): section is DocSection => section !== null);
}
