# Web Screenshot-led Site Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `apps/web` into a restrained, screenshot-led public site while keeping public docs focused on install, deployment, environment, CLI, and development material.

**Architecture:** Keep the public site as a Vite + React static app. Add a small landing-specific screenshot resolver that imports curated Studio screenshots, then compose the landing from focused components: `Hero`, `ScreenshotFrame`, `FeatureWalkthrough`, and the existing `InstallBlock`. Polish `DocsPage` in place so public docs remain separate from the in-app Studio docs registry.

**Tech Stack:** React 18, Vite 6, TypeScript, Tailwind CSS v4 token utilities, Radix UI tabs/select, lucide-react, react-router-dom HashRouter, react-markdown, remark-gfm, Vitest, Testing Library.

## Global Constraints

- Keep changes within `apps/web` plus this implementation plan unless the direct screenshot import requires copied public-site assets.
- Public docs stay in `apps/web/src/docs`; do not import the Studio docs registry into `apps/web`.
- Use real committed screenshots from `apps/studio/src/docs/0.1.0/screenshots`; do not generate images, stock media, illustrations, fake UI, gradients, decorative orbs, or visual filler.
- Use `dashboard-overview.png` as the hero screenshot.
- Use 4-5 screenshot-led feature sections: Workflows, Reports, Forms, Query and report design, Sync and administration.
- Keep installer behavior intact; only adjust visual layout and surrounding copy.
- Use existing dependencies and existing token palette; do not add a new design system, UI package, or visual library.
- Text must fit on mobile and desktop, especially CTAs, nav links, screenshot captions, and code commands.
- Commit after each task using the commit message listed in that task.

---

## File Structure

- Create `apps/web/src/landing/screenshots.ts`
  - Owns the curated public screenshot names, Vite asset imports, and filename-to-URL lookup.
  - Exposes `PUBLIC_SCREENSHOT_NAMES`, `PublicScreenshotName`, `makeScreenshotMap`, `SCREENSHOTS`, and `screenshotUrl`.
- Create `apps/web/src/landing/screenshots.test.ts`
  - Unit tests for URL map construction and missing-name behavior.
- Create `apps/web/src/components/ScreenshotFrame.tsx`
  - Reusable screenshot figure with stable dimensions, border, loading mode, and caption.
- Create `apps/web/src/components/ScreenshotFrame.test.tsx`
  - Component tests for image rendering, loading mode, caption, and missing image state.
- Create `apps/web/src/components/FeatureWalkthrough.tsx`
  - Curated screenshot-led feature sections for the landing page.
- Create `apps/web/src/components/FeatureWalkthrough.test.tsx`
  - Component tests for feature titles, screenshot alts, and concise point lists.
- Modify `apps/web/src/components/Hero.tsx`
  - Replace the centered text-only hero with product-first copy plus the primary screenshot.
- Create `apps/web/src/components/Hero.test.tsx`
  - Component tests for title, copy, CTAs, and hero screenshot.
- Modify `apps/web/src/components/InstallBlock.tsx`
  - Keep command logic unchanged; tune layout and copy to fit the refreshed page.
- Modify `apps/web/src/components/InstallBlock.test.tsx`
  - Preserve existing behavior tests; add one accessibility/layout assertion for the install region.
- Modify `apps/web/src/App.tsx`
  - Swap old feature-card usage for `FeatureWalkthrough`; tune header layout.
- Create `apps/web/src/App.test.tsx`
  - Route-level smoke tests for the landing route under `MemoryRouter`; docs route assertions are added with the docs task.
- Modify `apps/web/src/docs/DocsPage.tsx`
  - Professional public docs layout with sticky desktop nav, better mobile flow, and readable article width.
- Create `apps/web/src/docs/DocsPage.test.tsx`
  - Docs route tests for nav, active page, version selector, Markdown rendering, and internal links.
- Modify `apps/web/src/tokens.css`
  - Add small web-only layout/documentation utilities if Tailwind classes are not enough.
- Delete `apps/web/src/components/Features.tsx`
  - Remove the old generic feature grid when `App.tsx` is switched to `FeatureWalkthrough`.

---

### Task 1: Landing Screenshot Resolver

**Files:**
- Create: `apps/web/src/landing/screenshots.ts`
- Create: `apps/web/src/landing/screenshots.test.ts`

**Interfaces:**
- Consumes: committed PNG assets in `apps/studio/src/docs/0.1.0/screenshots`.
- Produces:
  - `PUBLIC_SCREENSHOT_NAMES: readonly string[]`
  - `type PublicScreenshotName`
  - `makeScreenshotMap(modules: Record<string, string>): Record<string, string>`
  - `SCREENSHOTS: Record<string, string>`
  - `screenshotUrl(name: PublicScreenshotName | string): string | null`

- [ ] **Step 1: Write the failing screenshot resolver tests**

Create `apps/web/src/landing/screenshots.test.ts`:

```ts
import { makeScreenshotMap, screenshotUrl } from './screenshots';

describe('landing screenshots', () => {
  it('keys imported screenshot URLs by bare filename', () => {
    const map = makeScreenshotMap({
      '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png': '/assets/dashboard.hash.png',
      '../../../studio/src/docs/0.1.0/screenshots/workflow-builder.png': '/assets/workflow.hash.png',
    });

    expect(map).toEqual({
      'dashboard-overview.png': '/assets/dashboard.hash.png',
      'workflow-builder.png': '/assets/workflow.hash.png',
    });
  });

  it('returns null for a screenshot name that is not available', () => {
    expect(screenshotUrl('missing-public-shot.png')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run:

```powershell
pnpm --filter @openldr/web test -- src/landing/screenshots.test.ts
```

Expected: command exits non-zero with an import error because `apps/web/src/landing/screenshots.ts` does not exist.

- [ ] **Step 3: Implement the screenshot resolver**

Create `apps/web/src/landing/screenshots.ts`:

```ts
export const PUBLIC_SCREENSHOT_NAMES = [
  'dashboard-overview.png',
  'workflow-builder.png',
  'reports-run-result.png',
  'form-builder.png',
  'query-workbench.png',
  'report-designer-canvas.png',
  'sync-settings-card.png',
] as const;

export type PublicScreenshotName = (typeof PUBLIC_SCREENSHOT_NAMES)[number];

const screenshotModules = import.meta.glob('../../../studio/src/docs/0.1.0/screenshots/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function makeScreenshotMap(modules: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
  );
}

export const SCREENSHOTS = makeScreenshotMap(screenshotModules);

export function screenshotUrl(name: PublicScreenshotName | string): string | null {
  return SCREENSHOTS[name] ?? null;
}
```

- [ ] **Step 4: Run resolver tests and typecheck**

Run:

```powershell
pnpm --filter @openldr/web test -- src/landing/screenshots.test.ts
pnpm --filter @openldr/web typecheck
```

Expected: screenshot resolver test passes; typecheck exits 0 with no TypeScript errors.

- [ ] **Step 5: Verify direct cross-app asset import builds**

Run:

```powershell
pnpm --filter @openldr/web build
```

Expected: build exits 0 and emitted assets include screenshot PNG files.

If the build fails because Vite rejects `../../../studio/src/docs/0.1.0/screenshots/*.png`, copy the curated assets and change only the glob path:

```powershell
New-Item -ItemType Directory -Force apps\web\src\assets\screenshots
Copy-Item apps\studio\src\docs\0.1.0\screenshots\dashboard-overview.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\workflow-builder.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\reports-run-result.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\form-builder.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\query-workbench.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\report-designer-canvas.png apps\web\src\assets\screenshots\
Copy-Item apps\studio\src\docs\0.1.0\screenshots\sync-settings-card.png apps\web\src\assets\screenshots\
```

Then replace the `import.meta.glob` path in `apps/web/src/landing/screenshots.ts` with:

```ts
const screenshotModules = import.meta.glob('../assets/screenshots/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
```

Run `pnpm --filter @openldr/web build` again and expect exit 0.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add apps/web/src/landing/screenshots.ts apps/web/src/landing/screenshots.test.ts
if (Test-Path apps\web\src\assets\screenshots) { git add apps\web\src\assets\screenshots }
git commit -m "feat(web): add public screenshot resolver"
```

Expected: commit succeeds.

---

### Task 2: Reusable Screenshot Frame

**Files:**
- Create: `apps/web/src/components/ScreenshotFrame.tsx`
- Create: `apps/web/src/components/ScreenshotFrame.test.tsx`

**Interfaces:**
- Consumes:
  - `screenshotUrl(name: PublicScreenshotName | string): string | null`
  - `type PublicScreenshotName`
- Produces:
  - `ScreenshotFrame(props: ScreenshotFrameProps): JSX.Element`
  - `interface ScreenshotFrameProps { name: PublicScreenshotName; alt: string; caption?: string; priority?: boolean; className?: string; }`

- [ ] **Step 1: Write the failing ScreenshotFrame tests**

Create `apps/web/src/components/ScreenshotFrame.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ScreenshotFrame } from './ScreenshotFrame';

vi.mock('@/landing/screenshots', () => ({
  screenshotUrl: (name: string) => (name === 'dashboard-overview.png' ? '/assets/dashboard.png' : null),
}));

describe('ScreenshotFrame', () => {
  it('renders a real screenshot with eager loading when priority is true', () => {
    render(
      <ScreenshotFrame
        name="dashboard-overview.png"
        alt="OpenLDR dashboard overview"
        caption="Dashboard overview"
        priority
      />,
    );

    const image = screen.getByRole('img', { name: 'OpenLDR dashboard overview' });
    expect(image).toHaveAttribute('src', '/assets/dashboard.png');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(screen.getByText('Dashboard overview')).toBeInTheDocument();
  });

  it('renders a quiet unavailable state when the screenshot URL is absent', () => {
    render(<ScreenshotFrame name="sync-settings-card.png" alt="Distributed Sync settings" />);

    expect(screen.getByRole('img', { name: /screenshot unavailable: distributed sync settings/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the ScreenshotFrame test and verify it fails**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/ScreenshotFrame.test.tsx
```

Expected: command exits non-zero because `ScreenshotFrame.tsx` does not exist.

- [ ] **Step 3: Implement ScreenshotFrame**

Create `apps/web/src/components/ScreenshotFrame.tsx`:

```tsx
import { screenshotUrl, type PublicScreenshotName } from '@/landing/screenshots';
import { cn } from '@/lib/cn';

export interface ScreenshotFrameProps {
  name: PublicScreenshotName;
  alt: string;
  caption?: string;
  priority?: boolean;
  className?: string;
}

export function ScreenshotFrame({
  name,
  alt,
  caption,
  priority = false,
  className,
}: ScreenshotFrameProps) {
  const url = screenshotUrl(name);

  if (!url) {
    return (
      <div
        role="img"
        aria-label={`Screenshot unavailable: ${alt}`}
        className={cn(
          'flex aspect-[16/10] w-full items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        Screenshot unavailable
      </div>
    );
  }

  return (
    <figure className={cn('w-full', className)}>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <img
          src={url}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          className="block aspect-[16/10] w-full object-cover object-top"
        />
      </div>
      {caption ? <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/ScreenshotFrame.test.tsx
pnpm --filter @openldr/web typecheck
```

Expected: ScreenshotFrame test passes; typecheck exits 0.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add apps/web/src/components/ScreenshotFrame.tsx apps/web/src/components/ScreenshotFrame.test.tsx
git commit -m "feat(web): add screenshot frame component"
```

Expected: commit succeeds.

---

### Task 3: Screenshot-led Feature Walkthrough

**Files:**
- Create: `apps/web/src/components/FeatureWalkthrough.tsx`
- Create: `apps/web/src/components/FeatureWalkthrough.test.tsx`

**Interfaces:**
- Consumes:
  - `ScreenshotFrame({ name, alt, caption, priority, className })`
- Produces:
  - `FeatureWalkthrough(): JSX.Element`

- [ ] **Step 1: Write the failing FeatureWalkthrough tests**

Create `apps/web/src/components/FeatureWalkthrough.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { FeatureWalkthrough } from './FeatureWalkthrough';

vi.mock('./ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt, caption }: { alt: string; caption?: string }) => (
    <figure>
      <img src="/mock.png" alt={alt} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  ),
}));

describe('FeatureWalkthrough', () => {
  it('renders the curated screenshot-led feature sections', () => {
    render(<FeatureWalkthrough />);

    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Forms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Query and report design' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sync and administration' })).toBeInTheDocument();

    expect(screen.getByRole('img', { name: 'OpenLDR workflow builder' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OpenLDR report run result' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OpenLDR form builder' })).toBeInTheDocument();
  });

  it('keeps every feature section concise', () => {
    render(<FeatureWalkthrough />);

    for (const title of ['Workflows', 'Reports', 'Forms', 'Query and report design', 'Sync and administration']) {
      const section = screen.getByRole('region', { name: title });
      const points = within(section).getAllByRole('listitem');
      expect(points).toHaveLength(3);
    }
  });
});
```

- [ ] **Step 2: Run the FeatureWalkthrough test and verify it fails**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/FeatureWalkthrough.test.tsx
```

Expected: command exits non-zero because `FeatureWalkthrough.tsx` does not exist.

- [ ] **Step 3: Implement FeatureWalkthrough**

Create `apps/web/src/components/FeatureWalkthrough.tsx`:

```tsx
import { ScreenshotFrame } from './ScreenshotFrame';
import type { PublicScreenshotName } from '@/landing/screenshots';

interface FeatureSection {
  title: string;
  eyebrow: string;
  body: string;
  image: PublicScreenshotName;
  imageAlt: string;
  points: [string, string, string];
}

const FEATURES: FeatureSection[] = [
  {
    title: 'Workflows',
    eyebrow: 'Build pipelines visually',
    body: 'Create repeatable data flows for ingestion, transformation, routing, and reporting without hiding the operational details.',
    image: 'workflow-builder.png',
    imageAlt: 'OpenLDR workflow builder',
    points: ['Node-based builder', 'Run history and inspection', 'Plugin-backed steps'],
  },
  {
    title: 'Reports',
    eyebrow: 'Turn lab data into outputs',
    body: 'Run reports from curated definitions, review results, and export the formats teams already use.',
    image: 'reports-run-result.png',
    imageAlt: 'OpenLDR report run result',
    points: ['Parameterized runs', 'Spreadsheet output', 'Scheduled delivery paths'],
  },
  {
    title: 'Forms',
    eyebrow: 'Capture structured data',
    body: 'Design and publish FHIR-backed forms for workflows that need consistent, governed data entry.',
    image: 'form-builder.png',
    imageAlt: 'OpenLDR form builder',
    points: ['Builder and capture views', 'Terminology-aware fields', 'Lifecycle controls'],
  },
  {
    title: 'Query and report design',
    eyebrow: 'Bridge exploration and templates',
    body: 'Explore connected data, save reusable queries, and bind them into printable report templates.',
    image: 'query-workbench.png',
    imageAlt: 'OpenLDR query workbench',
    points: ['Connector explorer', 'Saved SQL queries', 'Report template binding'],
  },
  {
    title: 'Sync and administration',
    eyebrow: 'Run across real deployments',
    body: 'Enroll sites, configure distributed sync, manage connectors, and keep operational activity visible.',
    image: 'sync-settings-card.png',
    imageAlt: 'OpenLDR distributed sync settings',
    points: ['Site enrollment', 'Connector settings', 'Audit-oriented operations'],
  },
];

export function FeatureWalkthrough() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16" aria-labelledby="features-heading">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase text-primary">Studio capabilities</p>
        <h2 id="features-heading" className="mt-2 text-2xl font-semibold">
          The pieces you need, shown directly.
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          OpenLDR is meant for teams managing laboratory data pipelines, reporting, forms, and operations from one self-hosted workspace.
        </p>
      </div>
      <div className="space-y-14">
        {FEATURES.map((feature, index) => (
          <section
            key={feature.title}
            aria-label={feature.title}
            className="grid items-center gap-6 border-t border-border pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]"
          >
            <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
              <p className="text-xs font-semibold uppercase text-primary">{feature.eyebrow}</p>
              <h3 className="mt-2 text-xl font-semibold">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.body}</p>
              <ul className="mt-4 grid gap-2 text-sm text-foreground sm:grid-cols-3 lg:grid-cols-1">
                {feature.points.map((point) => (
                  <li key={point} className="rounded-md border border-border bg-card px-3 py-2">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <ScreenshotFrame
              name={feature.image}
              alt={feature.imageAlt}
              caption={feature.title}
              className={index % 2 === 1 ? 'lg:order-1' : undefined}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/FeatureWalkthrough.test.tsx
pnpm --filter @openldr/web typecheck
```

Expected: FeatureWalkthrough test passes; typecheck exits 0 because the old `Features.tsx` file still exists until Task 4 switches the landing composition.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add apps/web/src/components/FeatureWalkthrough.tsx apps/web/src/components/FeatureWalkthrough.test.tsx
git commit -m "feat(web): add screenshot-led feature walkthrough"
```

Expected: commit succeeds.

---

### Task 4: Landing Composition and Install Polish

**Files:**
- Modify: `apps/web/src/components/Hero.tsx`
- Create: `apps/web/src/components/Hero.test.tsx`
- Modify: `apps/web/src/components/InstallBlock.tsx`
- Modify: `apps/web/src/components/InstallBlock.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/App.test.tsx`
- Delete: `apps/web/src/components/Features.tsx`

**Interfaces:**
- Consumes:
  - `ScreenshotFrame({ name, alt, caption, priority, className })`
  - `FeatureWalkthrough()`
  - `InstallBlock()`
- Produces:
  - Landing route `/` with hero screenshot, install block, and feature walkthrough.
  - Header links: `/docs`, `/studio/`, GitHub.

- [ ] **Step 1: Write the failing Hero test**

Create `apps/web/src/components/Hero.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';

vi.mock('./ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt }: { alt: string }) => <img src="/mock-dashboard.png" alt={alt} />,
}));

describe('Hero', () => {
  it('presents OpenLDR with clear CTAs and the dashboard screenshot', () => {
    render(<Hero />, { wrapper: MemoryRouter });

    expect(screen.getByRole('heading', { name: 'OpenLDR' })).toBeInTheDocument();
    expect(screen.getByText(/self-hosted laboratory data/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute('href', '#install');
    expect(screen.getByRole('link', { name: /read the docs/i })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('img', { name: 'OpenLDR dashboard overview' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing route-level App test**

Create `apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('@/components/ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt }: { alt: string }) => <img src="/mock.png" alt={alt} />,
}));

describe('App routes', () => {
  it('renders the screenshot-led landing route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'OpenLDR' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The pieces you need, shown directly.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Install in one line/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Add the install region assertion to the existing install tests**

Append this test inside `apps/web/src/components/InstallBlock.test.tsx`:

```tsx
  it('labels the install section for page navigation', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /install openldr/i })).toHaveAttribute('id', 'install');
  });
```

- [ ] **Step 4: Run the landing tests and verify they fail**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/Hero.test.tsx src/App.test.tsx src/components/InstallBlock.test.tsx
```

Expected: command exits non-zero because `Hero` has the old title/copy, `App` still imports `Features`, and `InstallBlock` does not expose the requested region label.

- [ ] **Step 5: Replace Hero with the screenshot-led hero**

Replace `apps/web/src/components/Hero.tsx` with:

```tsx
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScreenshotFrame } from './ScreenshotFrame';

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] lg:py-20">
      <div>
        <p className="text-xs font-semibold uppercase text-primary">Open laboratory data repository</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">OpenLDR</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          Self-hosted laboratory data ingestion, workflows, forms, reports, and distributed sync for teams that need operational control.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href="#install">
              Get started
              <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/docs">
              <BookOpen className="h-4 w-4" />
              Read the docs
            </Link>
          </Button>
        </div>
      </div>
      <ScreenshotFrame
        name="dashboard-overview.png"
        alt="OpenLDR dashboard overview"
        caption="Studio dashboard overview"
        priority
      />
    </section>
  );
}
```

- [ ] **Step 6: Polish InstallBlock layout without changing command behavior**

In `apps/web/src/components/InstallBlock.tsx`, change the section opening and heading area to:

```tsx
    <section
      id="install"
      aria-labelledby="install-heading"
      className="mx-auto max-w-4xl px-6 py-16"
    >
      <div className="mb-6 max-w-2xl">
        <p className="text-xs font-semibold uppercase text-primary">Install</p>
        <h2 id="install-heading" className="mt-2 text-2xl font-semibold">
          Install OpenLDR in one line
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Requires Docker. The installer brings up the full self-hosted stack locally.
        </p>
      </div>
```

In the same file, change `Tabs` to:

```tsx
      <Tabs defaultValue="unix" className="w-full">
```

Keep `CommandRow`, `COMMANDS`, and every tab command string unchanged.

- [ ] **Step 7: Compose the landing route with FeatureWalkthrough**

Modify imports in `apps/web/src/App.tsx`:

```tsx
import { Routes, Route, Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { InstallBlock } from '@/components/InstallBlock';
import { FeatureWalkthrough } from '@/components/FeatureWalkthrough';
import { Footer } from '@/components/Footer';
import { DocsPage } from '@/docs/DocsPage';
```

Replace `Landing` with:

```tsx
function Landing() {
  return (
    <>
      <Hero />
      <FeatureWalkthrough />
      <InstallBlock />
    </>
  );
}
```

Replace the header element with:

```tsx
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <Link to="/" className="text-base font-semibold text-foreground">OpenLDR</Link>
        <nav className="flex items-center gap-4 text-sm" aria-label="Primary">
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
          <a href="/studio/" className="text-muted-foreground hover:text-foreground">Studio</a>
          <a href="https://github.com/Open-Laboratory-Data-Repository/openldr" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>
```

- [ ] **Step 8: Delete the old generic feature grid**

Delete `apps/web/src/components/Features.tsx`.

- [ ] **Step 9: Run focused landing tests**

Run:

```powershell
pnpm --filter @openldr/web test -- src/components/Hero.test.tsx src/components/FeatureWalkthrough.test.tsx src/components/InstallBlock.test.tsx src/App.test.tsx
pnpm --filter @openldr/web typecheck
```

Expected: focused tests pass; typecheck exits 0.

- [ ] **Step 10: Commit Task 4**

Run:

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/Hero.tsx apps/web/src/components/Hero.test.tsx apps/web/src/components/InstallBlock.tsx apps/web/src/components/InstallBlock.test.tsx
git add -u apps/web/src/components
git commit -m "feat(web): compose screenshot-led landing page"
```

Expected: commit succeeds.

---

### Task 5: Professional Public Docs Layout

**Files:**
- Modify: `apps/web/src/docs/DocsPage.tsx`
- Create: `apps/web/src/docs/DocsPage.test.tsx`
- Modify: `apps/web/src/tokens.css`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `DOC_VERSIONS`, `DEFAULT_DOC_VERSION`, `NAV`, `TITLES`, `docBody` from `apps/web/src/docs/content.ts`
  - React Router `useParams` and `Link`
- Produces:
  - `DocsPage(): JSX.Element` with `nav` labelled `Public documentation`, `article`, sticky desktop sidebar, version selector, and HashRouter-safe Markdown links.

- [ ] **Step 1: Write the failing DocsPage tests**

Create `apps/web/src/docs/DocsPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsPage } from './DocsPage';

function renderDocs(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:page" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsPage', () => {
  it('renders a professional docs shell for a public doc page', () => {
    renderDocs('/docs/install');

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Documentation version')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
  });

  it('falls back to getting started when the route slug is unknown', () => {
    renderDocs('/docs/not-a-page');

    expect(screen.getByRole('link', { name: 'Getting started' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the docs test and verify it fails**

Run:

```powershell
pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx
```

Expected: command exits non-zero because the current docs nav has no accessible `Public documentation` label, links do not expose `aria-current`, or the route fallback behavior is incomplete for the new shell.

- [ ] **Step 3: Replace the docs page layout**

In `apps/web/src/docs/DocsPage.tsx`, keep imports and `MARKDOWN_COMPONENTS`, then replace `NavLink` and `DocsPage` with:

```tsx
function NavLink({ slug, active, nested }: { slug: string; active: string; nested?: boolean }) {
  const isActive = slug === active;
  return (
    <Link
      to={`/docs/${slug}`}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'block rounded-md px-3 py-2 text-sm no-underline transition-colors',
        nested ? 'ml-3' : '',
        isActive
          ? 'bg-accent text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {TITLES[slug]}
    </Link>
  );
}

export function DocsPage() {
  const { page } = useParams();
  const [version, setVersion] = useState(DEFAULT_DOC_VERSION);
  const key = page && TITLES[page] ? page : 'getting-started';
  const body = docBody(key, version);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase text-primary">Documentation</p>
          <h1 className="mt-2 text-2xl font-semibold">Public docs</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Install, configure, deploy, and develop OpenLDR.
          </p>
        </div>
        <Select value={version} onValueChange={setVersion}>
          <SelectTrigger className="h-8 w-full gap-1 px-2 text-xs" aria-label="Documentation version">
            <span className="text-muted-foreground">Version</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOC_VERSIONS.map((docVersion) => (
              <SelectItem key={docVersion} value={docVersion} className="text-xs">
                {docVersion}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <nav aria-label="Public documentation" className="mt-4 space-y-1 border-t border-border pt-4">
          {NAV.map((item) => (
            <div key={item.slug} className="space-y-1">
              <NavLink slug={item.slug} active={key} />
              {item.children?.map((child) => (
                <NavLink key={child} slug={child} active={key} nested />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <article className="doc-content min-w-0 max-w-3xl" aria-labelledby="doc-title">
        <div className="mb-6 border-b border-border pb-4">
          <p className="text-xs font-medium text-muted-foreground">OpenLDR {version}</p>
          <h2 id="doc-title" className="mt-1 text-3xl font-semibold">
            {TITLES[key]}
          </h2>
        </div>
        {body == null ? (
          <p className="text-muted-foreground">This page is not available for version {version}.</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {body}
          </ReactMarkdown>
        )}
      </article>
    </div>
  );
}
```

- [ ] **Step 4: Add docs-specific CSS guardrails**

Append these rules to `apps/web/src/tokens.css` near the existing `.doc-content` rules:

```css
.doc-content > :first-child { margin-top: 0; }
.doc-content h1:first-child { display: none; }
.doc-content img {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
```

- [ ] **Step 5: Add a docs route smoke to App.test**

Append this test inside `apps/web/src/App.test.tsx`:

```tsx
  it('renders public docs from the docs route', () => {
    render(
      <MemoryRouter initialEntries={['/docs/install']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: /public documentation/i })).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run docs tests and typecheck**

Run:

```powershell
pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx src/App.test.tsx
pnpm --filter @openldr/web typecheck
```

Expected: docs tests pass; route-level test passes; typecheck exits 0.

- [ ] **Step 7: Commit Task 5**

Run:

```powershell
git add apps/web/src/docs/DocsPage.tsx apps/web/src/docs/DocsPage.test.tsx apps/web/src/tokens.css apps/web/src/App.test.tsx
git commit -m "feat(web): polish public docs layout"
```

Expected: commit succeeds.

---

### Task 6: Full Verification and Visual Inspection

**Files:**
- Modify only files required to fix failures found by the commands in this task.

**Interfaces:**
- Consumes all outputs from Tasks 1-5.
- Produces a verified `@openldr/web` app that builds, passes tests, and renders the landing/docs pages with real screenshots.

- [ ] **Step 1: Run the complete web test suite**

Run:

```powershell
pnpm --filter @openldr/web test
```

Expected: all `@openldr/web` Vitest files pass.

- [ ] **Step 2: Run web typecheck**

Run:

```powershell
pnpm --filter @openldr/web typecheck
```

Expected: TypeScript exits 0 with no diagnostics.

- [ ] **Step 3: Run the production build**

Run:

```powershell
pnpm --filter @openldr/web build
```

Expected: Vite exits 0 and writes `apps/web/dist`.

- [ ] **Step 4: Start the local dev server**

Run:

```powershell
pnpm --filter @openldr/web dev -- --host 127.0.0.1 --port 4178
```

Expected: Vite prints a local URL containing `http://127.0.0.1:4178/`. Leave this process running for visual inspection.

- [ ] **Step 5: Inspect desktop landing and docs**

Open:

```text
http://127.0.0.1:4178/#/
http://127.0.0.1:4178/#/docs/install
```

At a desktop viewport around 1440x900, verify:

- Header is compact and not visually dominant.
- Hero screenshot renders as the real dashboard image.
- Feature sections render real screenshots with no dark overlay, blur, or tiny unreadable thumbnails.
- Install command tabs still switch between Linux/macOS, Windows, and Windows Server.
- Docs page has a left navigation labelled `Public documentation`, a version selector, and a readable article column.

- [ ] **Step 6: Inspect mobile landing and docs**

Using browser responsive mode or Playwright, inspect widths near 390px and 768px:

```text
http://127.0.0.1:4178/#/
http://127.0.0.1:4178/#/docs/install
```

Verify:

- Header links fit without overlapping.
- Hero CTAs wrap cleanly.
- Screenshot frames keep stable dimensions and do not cause horizontal scrolling.
- Feature point labels fit inside their boxes.
- Install command row scrolls horizontally inside the code area rather than widening the page.
- Docs nav stacks above content or remains readable without trapping the article.

- [ ] **Step 7: Fix visual or test failures with scoped edits**

If a failure appears, apply the smallest scoped change to the file responsible for that behavior. Examples:

```tsx
// If screenshot images crop too tightly, change ScreenshotFrame image class:
className="block aspect-[16/10] w-full object-contain object-top"
```

```tsx
// If header links crowd on mobile, change the nav gap:
<nav className="flex items-center gap-3 text-sm" aria-label="Primary">
```

```tsx
// If command text widens the page, ensure CommandRow keeps the code scrollable:
<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
```

After any fix, rerun:

```powershell
pnpm --filter @openldr/web test
pnpm --filter @openldr/web typecheck
pnpm --filter @openldr/web build
```

Expected: all three commands pass.

- [ ] **Step 8: Stop the dev server**

Stop the `pnpm --filter @openldr/web dev` process with `Ctrl+C`.

Expected: terminal returns to the prompt.

- [ ] **Step 9: Commit Task 6**

Run:

```powershell
git status --short
git add apps/web
git commit -m "test(web): verify screenshot-led public site"
```

Expected: commit succeeds if Task 6 required verification fixes. If `git status --short` shows no modified `apps/web` files after verification, do not create an empty commit.

---

## Plan Self-Review

**Spec coverage:** Covered the screenshot-led landing, hero screenshot decision, public docs scope, docs layout polish, existing install block behavior, asset sourcing, existing dependencies, mobile/desktop fit, and final verification. No spec requirement is intentionally excluded.

**Red-flag scan:** The plan avoids deferred sections and names exact files, commands, expected results, component interfaces, and concrete code for each implementation step.

**Type consistency:** `PublicScreenshotName`, `screenshotUrl`, `ScreenshotFrameProps`, `ScreenshotFrame`, and `FeatureWalkthrough` are introduced before any later task consumes them. All referenced routes and aliases match the current `@openldr/web` Vite config.
