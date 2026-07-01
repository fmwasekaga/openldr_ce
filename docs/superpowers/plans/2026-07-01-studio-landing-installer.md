# Studio/Web Split + Landing Page + One-Line Installer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single SPA into a renamed application (`apps/studio`) and a new public landing/docs site (`apps/web`) whose headline feature is a one-line Docker installer.

**Architecture:** Three sequenced slices, each ending green and committed atomically. Slice 1 is a mechanical rename that repoints every build/e2e reference from `@openldr/web` to `@openldr/studio` (so the freed `@openldr/web` name can be reused). Slice 2 scaffolds a lightweight Vite+React static landing site that copies the studio's design tokens + a few shadcn primitives. Slice 3 adds `install.sh`/`install.ps1` that scaffold a local `openldr/` directory and bring up an image-based Docker Compose stack.

**Tech Stack:** pnpm workspaces + turbo, Vite + React 19, Tailwind v4 (`@tailwindcss/vite`), react-router-dom (HashRouter), react-markdown, Docker Compose, POSIX sh + PowerShell.

**Reference spec:** `docs/superpowers/specs/2026-07-01-studio-landing-installer-design.md`

---

## File Structure

**Slice 1 (rename) — modify:**
- `apps/web/` → `apps/studio/` (directory move)
- `apps/studio/package.json` (name)
- `apps/server/src/app.ts` (default SPA path)
- `package.json` (3 root scripts)
- `Dockerfile` (build filter + copy path)
- `e2e/capture-docs/docs-screenshots.spec.ts`, `manifest.test.ts`, `manifest.ts`
- `e2e/tests/plugin-ui.spec.ts` (comment)

**Slice 2 (landing) — create under new `apps/web/`:**
- `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- `apps/web/src/main.tsx`, `App.tsx`, `tokens.css` (copied)
- `apps/web/src/lib/cn.ts` (copied)
- `apps/web/src/components/ui/{button,tabs,card}.tsx` (copied)
- `apps/web/src/components/{Hero,InstallBlock,Features,Footer}.tsx`
- `apps/web/src/docs/{DocsPage.tsx, getting-started.md, install.md, requirements.md}`
- `apps/web/src/components/InstallBlock.test.tsx`

**Slice 3 (installer) — create:**
- `install/install.sh`, `install/install.ps1`
- `deploy/install/docker-compose.yml`
- `RELEASE.md`

---

## SLICE 1 — Rename `apps/web` → `apps/studio`

### Task 1: Move the directory and rename the package

**Files:**
- Move: `apps/web/` → `apps/studio/`
- Modify: `apps/studio/package.json`

- [ ] **Step 1: Move the directory with git**

Run (bash):
```bash
cd /d/Projects/Repositories/openldr_ce
git mv apps/web apps/studio
```

- [ ] **Step 2: Rename the package**

In `apps/studio/package.json`, change line 2:
```json
  "name": "@openldr/studio",
```

- [ ] **Step 3: Relink the workspace**

Run:
```bash
pnpm install
```
Expected: completes without error; `apps/studio` is linked as `@openldr/studio`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move apps/web to apps/studio (@openldr/studio)"
```

### Task 2: Repoint the server's default SPA path

**Files:**
- Modify: `apps/server/src/app.ts:75`
- Test: `apps/server/src/app.test.ts` (existing SPA static-root suite)

- [ ] **Step 1: Update the default path**

In `apps/server/src/app.ts`, change the fallback in line ~75 from `../../web/dist` to `../../studio/dist`:
```ts
  const webDist = process.env.WEB_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/dist');
```

- [ ] **Step 2: Run the server tests**

Run:
```bash
pnpm --filter @openldr/server test
```
Expected: PASS (the SPA static-root suite uses an explicit `WEB_DIST_DIR`, so it stays green; this change only affects the workspace default).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "refactor: default studio SPA path to ../../studio/dist"
```

### Task 3: Repoint root scripts, Dockerfile, and e2e references

**Files:**
- Modify: `package.json` (scripts `e2e`, `verify:ui`, `docs:screenshots`)
- Modify: `Dockerfile` (lines ~8, ~12)
- Modify: `e2e/capture-docs/docs-screenshots.spec.ts:22`, `e2e/capture-docs/manifest.test.ts:8`, `e2e/capture-docs/manifest.ts:33`
- Modify: `e2e/tests/plugin-ui.spec.ts:17`

- [ ] **Step 1: Update root package.json scripts**

Replace `@openldr/web` with `@openldr/studio` in the three scripts:
```json
    "e2e": "turbo build --filter=@openldr/studio --filter=@openldr/server && pnpm --filter @openldr/e2e e2e",
    "verify:ui": "turbo build --filter=@openldr/studio --filter=@openldr/server && pnpm --filter @openldr/e2e capture",
    "docs:screenshots": "turbo build --filter=@openldr/studio --filter=@openldr/server && pnpm --filter @openldr/e2e docs:screenshots",
```

- [ ] **Step 2: Update the Dockerfile**

Line ~8:
```dockerfile
RUN pnpm turbo build --filter @openldr/studio --filter @openldr/server
```
Line ~12:
```dockerfile
RUN mkdir -p /deploy/web && cp -r apps/studio/dist/. /deploy/web/
```
(The `/deploy/web` destination and `WEB_DIST_DIR` env stay as-is — only the *source* path changes.)

- [ ] **Step 3: Update the e2e capture-docs paths**

`e2e/capture-docs/docs-screenshots.spec.ts:22`:
```ts
const OUT = fileURLToPath(new URL('../../apps/studio/src/docs/0.1.0/screenshots/', import.meta.url));
```
`e2e/capture-docs/manifest.test.ts:8`:
```ts
  new URL('../../apps/studio/src/docs/registry.ts', import.meta.url),
```
`e2e/capture-docs/manifest.ts:33`:
```ts
  new URL('../../apps/studio/src/docs/0.1.0/screenshot-manifest.json', import.meta.url),
```

- [ ] **Step 4: Update the plugin-ui comment**

`e2e/tests/plugin-ui.spec.ts:17`:
```ts
 *   - Server built: pnpm turbo build --filter=@openldr/server --filter=@openldr/studio
```

- [ ] **Step 5: Sweep for stray references**

Run:
```bash
grep -rn "@openldr/web\|apps/web" --include="*.ts" --include="*.tsx" --include="*.json" --include="Dockerfile" --include="*.mjs" apps packages e2e Dockerfile package.json 2>/dev/null | grep -v node_modules
```
Expected: no output (the new `apps/web` landing does not exist yet, so any hit is a missed rename — fix it). Internal studio self-references (labels in `apps/studio/src/workflows/constants.ts`, `apps/studio/src/docs/version.ts`) are cosmetic; leave functional behavior unchanged but update obvious path/name strings if present.

- [ ] **Step 6: Verify the build**

Run:
```bash
pnpm build --filter @openldr/studio --filter @openldr/server
```
Expected: both build to `dist/` with no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json Dockerfile e2e
git commit -m "refactor: repoint build/e2e references to @openldr/studio"
```

### Task 4: End-to-end verification of the rename

- [ ] **Step 1: Run the e2e smoke against the renamed app**

Run:
```bash
pnpm e2e
```
Expected: the server boots, serves the studio SPA from `apps/studio/dist`, smoke test passes. If it fails on the SPA not being found, re-check Task 2 (server default path) and the Dockerfile is not involved in local e2e.

- [ ] **Step 2: No commit** (verification only). Slice 1 complete.

---

## SLICE 2 — New `apps/web` landing app (`@openldr/web`)

### Task 5: Scaffold the landing package

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@openldr/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-tabs": "^1.1.15",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.469.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.1",
    "react-router-dom": "^7.1.1",
    "remark-gfm": "^4.0.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
  }
}
```
> Note: match the exact versions used by `apps/studio/package.json` where they overlap (react, tailwind, vite, radix, testing-library). Open `apps/studio/package.json` and copy the resolved versions to avoid duplicate installs.

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenLDR — Open Laboratory Data Repository</title>
    <meta name="description" content="OpenLDR CE — ingest, transform, and report laboratory data. Self-host in one line." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install and commit**

```bash
pnpm install
git add apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html
git commit -m "feat(web): scaffold landing app package"
```

### Task 6: Copy design tokens and UI primitives

**Files:**
- Create: `apps/web/src/tokens.css`, `apps/web/src/lib/cn.ts`, `apps/web/src/setupTests.ts`
- Create: `apps/web/src/components/ui/{button,tabs,card}.tsx`

- [ ] **Step 1: Copy the files verbatim from studio**

Run:
```bash
cd /d/Projects/Repositories/openldr_ce
mkdir -p apps/web/src/lib apps/web/src/components/ui
cp apps/studio/src/tokens.css apps/web/src/tokens.css
cp apps/studio/src/lib/cn.ts apps/web/src/lib/cn.ts
cp apps/studio/src/setupTests.ts apps/web/src/setupTests.ts
cp apps/studio/src/components/ui/button.tsx apps/web/src/components/ui/button.tsx
cp apps/studio/src/components/ui/tabs.tsx apps/web/src/components/ui/tabs.tsx
cp apps/studio/src/components/ui/card.tsx apps/web/src/components/ui/card.tsx
```

- [ ] **Step 2: Verify no broken imports**

Open each copied `components/ui/*.tsx` and confirm imports resolve under the landing app: they should import from `@/lib/cn` and `@radix-ui/*` / `class-variance-authority` only (all present in Task 5 deps). If `card.tsx` or `tabs.tsx` import anything else (e.g. an icon or a helper not copied), copy that dependency too or inline it.

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm --filter @openldr/web typecheck
```
Expected: PASS (or fail only on the not-yet-created `main.tsx`/`App.tsx` — that is fine at this step; re-run after Task 7).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): copy design tokens and shadcn primitives"
```

### Task 7: App shell, entry, and router

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './tokens.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
```
> HashRouter is used so the static site works on any host (GitHub Pages / Netlify) without server-side rewrite rules.

- [ ] **Step 2: Create `apps/web/src/App.tsx`**

```tsx
import { Routes, Route, Link } from 'react-router-dom';
import { Hero } from '@/components/Hero';
import { InstallBlock } from '@/components/InstallBlock';
import { Features } from '@/components/Features';
import { Footer } from '@/components/Footer';
import { DocsPage } from '@/docs/DocsPage';

function Landing() {
  return (
    <>
      <Hero />
      <InstallBlock />
      <Features />
    </>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link to="/" className="text-lg font-semibold text-foreground">OpenLDR</Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
          <a href="https://github.com/fmwasekaga/openldr_ce" className="text-muted-foreground hover:text-foreground">GitHub</a>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:page" element={<DocsPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 3: Commit** (components created next tasks; typecheck deferred to Task 11)

```bash
git add apps/web/src/main.tsx apps/web/src/App.tsx
git commit -m "feat(web): app shell, entry, and hash router"
```

### Task 8: Install block (headline feature) — TDD

**Files:**
- Create: `apps/web/src/components/InstallBlock.tsx`
- Test: `apps/web/src/components/InstallBlock.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/InstallBlock.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { InstallBlock } from './InstallBlock';

describe('InstallBlock', () => {
  it('shows the Linux/macOS curl command by default', () => {
    render(<InstallBlock />);
    expect(screen.getByText(/curl -fsSL/)).toBeInTheDocument();
    expect(screen.getByText(/install\.sh \| bash/)).toBeInTheDocument();
  });

  it('shows the Windows PowerShell command when the Windows tab is selected', () => {
    render(<InstallBlock />);
    fireEvent.click(screen.getByRole('tab', { name: /windows/i }));
    expect(screen.getByText(/irm/)).toBeInTheDocument();
    expect(screen.getByText(/install\.ps1/)).toBeInTheDocument();
  });

  it('copies the active command to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InstallBlock />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('install.sh'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
pnpm --filter @openldr/web test -- InstallBlock
```
Expected: FAIL ("Cannot find module './InstallBlock'").

- [ ] **Step 3: Implement `apps/web/src/components/InstallBlock.tsx`**

```tsx
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

// Served from raw GitHub until the landing has a stable domain; then switch to
// https://<domain>/install.sh and /install.ps1.
const BASE = 'https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install';
const COMMANDS: Record<string, string> = {
  unix: `curl -fsSL ${BASE}/install.sh | bash`,
  windows: `irm ${BASE}/install.ps1 | iex`,
};

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 font-mono text-sm">
      <code className="flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <Button variant="ghost" size="icon" aria-label="Copy command" onClick={copy}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function InstallBlock() {
  return (
    <section id="install" className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h2 className="mb-2 text-2xl font-semibold">Install in one line</h2>
      <p className="mb-6 text-muted-foreground">Requires Docker. Brings up the full stack locally.</p>
      <Tabs defaultValue="unix" className="w-full">
        <TabsList>
          <TabsTrigger value="unix">Linux / macOS</TabsTrigger>
          <TabsTrigger value="windows">Windows</TabsTrigger>
        </TabsList>
        <TabsContent value="unix"><CommandRow command={COMMANDS.unix} /></TabsContent>
        <TabsContent value="windows"><CommandRow command={COMMANDS.windows} /></TabsContent>
      </Tabs>
    </section>
  );
}
```
> If the copied `tabs.tsx` exports different names than `Tabs/TabsList/TabsTrigger/TabsContent`, adjust the imports to match the actual exports (open `apps/web/src/components/ui/tabs.tsx` to confirm).

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
pnpm --filter @openldr/web test -- InstallBlock
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/InstallBlock.tsx apps/web/src/components/InstallBlock.test.tsx
git commit -m "feat(web): one-line install block with OS tabs and copy"
```

### Task 9: Hero, Features, Footer

**Files:**
- Create: `apps/web/src/components/Hero.tsx`, `Features.tsx`, `Footer.tsx`

- [ ] **Step 1: Create `apps/web/src/components/Hero.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="mb-4 text-4xl font-semibold tracking-tight">Open Laboratory Data Repository</h1>
      <p className="mb-8 text-lg text-muted-foreground">
        Ingest, transform, and report laboratory data. Self-hosted, extensible, open source.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Button asChild><a href="#install">Get started</a></Button>
        <Button asChild variant="secondary"><Link to="/docs">Read the docs</Link></Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/Features.tsx`**

```tsx
import { Card } from '@/components/ui/card';

const FEATURES = [
  { title: 'Ingestion', body: 'HL7v2, CSV/Excel, and WHONET via pluggable converters.' },
  { title: 'Workflows', body: 'A visual node builder for transform, route, and report pipelines.' },
  { title: 'Forms', body: 'Build and run FHIR-backed data-collection forms.' },
  { title: 'DHIS2', body: 'Push aggregate and tracker data to DHIS2 as a sink plugin.' },
  { title: 'Reports', body: 'Scheduled SQL → Excel-template → email report pipelines.' },
  { title: 'Extensible', body: 'Signed, capability-scoped plugins with their own UI and data.' },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-5">
            <h3 className="mb-1 text-base font-medium">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
```
> If the copied `card.tsx` requires sub-components (e.g. `CardHeader`/`CardContent`) rather than accepting arbitrary children with `className`, adjust to match its actual API.

- [ ] **Step 3: Create `apps/web/src/components/Footer.tsx`**

```tsx
export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
      <p>
        OpenLDR CE · <a href="https://github.com/fmwasekaga/openldr_ce">GitHub</a> · Apache-2.0
      </p>
    </footer>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Hero.tsx apps/web/src/components/Features.tsx apps/web/src/components/Footer.tsx
git commit -m "feat(web): hero, features, and footer sections"
```

### Task 10: Public docs pages

**Files:**
- Create: `apps/web/src/docs/DocsPage.tsx`
- Create: `apps/web/src/docs/{getting-started.md, install.md, requirements.md}`

- [ ] **Step 1: Create the three markdown files**

`apps/web/src/docs/requirements.md`:
```markdown
# Requirements

- **Docker** 24+ with the Compose plugin (`docker compose`).
- 4 GB RAM free and ~5 GB disk for images and volumes.
- Linux, macOS, or Windows (WSL2 recommended on Windows).
```

`apps/web/src/docs/install.md`:
```markdown
# Install

Run the one-line installer:

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.ps1 | iex
```

The installer creates an `openldr/` directory, generates secrets, pulls the
images, and starts the stack. When it finishes it prints the URL and the
generated admin credentials.
```

`apps/web/src/docs/getting-started.md`:
```markdown
# Getting started

After installing, open the printed URL in your browser and sign in with the
generated admin credentials. From there you can install plugins, build
workflows, and configure connectors.

To stop or start the stack later, run `docker compose down` / `docker compose up -d`
from inside the `openldr/` directory the installer created.
```

- [ ] **Step 2: Create `apps/web/src/docs/DocsPage.tsx`**

```tsx
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import gettingStarted from './getting-started.md?raw';
import install from './install.md?raw';
import requirements from './requirements.md?raw';

const PAGES: Record<string, { title: string; body: string }> = {
  'getting-started': { title: 'Getting started', body: gettingStarted },
  install: { title: 'Install', body: install },
  requirements: { title: 'Requirements', body: requirements },
};
const ORDER = ['getting-started', 'install', 'requirements'];

export function DocsPage() {
  const { page } = useParams();
  const key = page && PAGES[page] ? page : 'getting-started';
  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-6 py-12">
      <nav className="w-48 shrink-0 space-y-1 text-sm">
        {ORDER.map((k) => (
          <Link
            key={k}
            to={`/docs/${k}`}
            className={k === key ? 'block text-foreground' : 'block text-muted-foreground hover:text-foreground'}
          >
            {PAGES[k].title}
          </Link>
        ))}
      </nav>
      <article className="doc-content prose min-w-0 flex-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{PAGES[key].body}</ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Add a markdown `?raw` type declaration**

Create `apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

declare module '*.md?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter @openldr/web typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs apps/web/src/vite-env.d.ts
git commit -m "feat(web): public docs pages (getting-started/install/requirements)"
```

### Task 11: Build and verify the landing app

- [ ] **Step 1: Run the full test + build**

Run:
```bash
pnpm --filter @openldr/web test
pnpm --filter @openldr/web build
```
Expected: tests PASS; `apps/web/dist/` is produced with no errors.

- [ ] **Step 2: Manual render smoke (optional but recommended)**

Run:
```bash
pnpm --filter @openldr/web preview
```
Open the printed URL, confirm: hero renders, install block copy button works, OS tabs switch the command, `/#/docs` renders markdown.

- [ ] **Step 3: No commit** (verification only). Slice 2 complete.

---

## SLICE 3 — One-line installer + image-based compose bundle

### Task 12: Image-based install compose file

**Files:**
- Create: `deploy/install/docker-compose.yml`

- [ ] **Step 1: Create `deploy/install/docker-compose.yml`**

This mirrors `docker-compose.prod.yml` but the `app` service uses a published
image and every mount is relative to the scaffolded `openldr/` directory (no
source-checkout paths).

```yaml
# Installer-target stack: pulls the published app image and mounts only the
# config files the installer downloads next to this file. Do not use build: here.
services:
  app:
    image: ghcr.io/fmwasekaga/openldr:${OPENLDR_VERSION:-latest}
    env_file: .env
    expose: ["3000"]
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_started }
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports: ["80:80", "443:443"]
    volumes:
      - ./config/nginx/openldr.conf.template:/etc/nginx/templates/default.conf.template:ro
      - ./config/nginx/certs:/etc/nginx/certs:ro
    depends_on: ["app"]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openldr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openldr}
      POSTGRES_DB: openldr
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openldr"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./config/init-target-db.sql:/docker-entrypoint-initdb.d/10-init-target-db.sql:ro
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: server /data --console-address ':9001'
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:-minioadmin}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:-minioadmin}
    volumes:
      - miniodata:/data
    restart: unless-stopped

  minio-init:
    image: minio/mc:latest
    depends_on: ["minio"]
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 ${S3_ACCESS_KEY_ID:-minioadmin} ${S3_SECRET_ACCESS_KEY:-minioadmin}; do echo 'waiting for minio'; sleep 2; done &&
      mc mb --ignore-existing local/${S3_BUCKET:-openldr} &&
      echo 'bucket ready'"

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN:-admin}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-admin}
    volumes:
      - ./config/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    ports: ["8180:8080"]
    restart: unless-stopped

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 2: Commit**

```bash
git add deploy/install/docker-compose.yml
git commit -m "feat(install): image-based compose bundle for the installer"
```

### Task 13: `install.sh` (Linux/macOS)

**Files:**
- Create: `install/install.sh`

- [ ] **Step 1: Create `install/install.sh`**

```sh
#!/usr/bin/env sh
# OpenLDR CE one-line installer (Linux/macOS).
#   curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh | bash
# Flags: --dir <path> (default ./openldr), --version <tag> (default latest),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
set -eu

REPO_RAW="https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main"
DIR="./openldr"
VERSION="latest"
NO_START=0
NO_PULL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --no-start) NO_START=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

err() { echo "✗ $1" >&2; exit 1; }

# 1. Preflight
command -v docker >/dev/null 2>&1 || err "Docker is not installed. See https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."

# 2. Scaffold
echo "→ Scaffolding $DIR"
mkdir -p "$DIR/config/nginx/certs" "$DIR/config/keycloak"
fetch() { curl -fsSL "$REPO_RAW/$1" -o "$2" || err "failed to download $1"; }
fetch "deploy/install/docker-compose.yml" "$DIR/docker-compose.yml"
fetch "deploy/nginx/openldr.conf.template" "$DIR/config/nginx/openldr.conf.template"
fetch "infra/keycloak/openldr-realm.json" "$DIR/config/keycloak/openldr-realm.json"
fetch "scripts/init-target-db.sql" "$DIR/config/init-target-db.sql"

# 3. Secrets + cert (only on first run — never overwrite an existing .env)
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24; }
if [ ! -f "$DIR/.env" ]; then
  PG_PW="$(rand)"; KC_PW="$(rand)"; S3_KEY="$(rand)"; S3_SECRET="$(rand)"
  cat > "$DIR/.env" <<EOF
OPENLDR_VERSION=$VERSION
SERVER_NAME=localhost
PORT=3000
NODE_ENV=production
INTERNAL_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target
POSTGRES_PASSWORD=$PG_PW
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$S3_KEY
S3_SECRET_ACCESS_KEY=$S3_SECRET
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=http://host.docker.internal:8180/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$KC_PW
EOF
  echo "→ Wrote $DIR/.env (generated secrets)"
else
  echo "→ Reusing existing $DIR/.env"
fi

if [ ! -f "$DIR/config/nginx/certs/fullchain.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$DIR/config/nginx/certs/privkey.pem" \
    -out "$DIR/config/nginx/certs/fullchain.pem" \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null \
    && echo "→ Generated self-signed cert" || echo "! openssl not found — provide certs in $DIR/config/nginx/certs/"
fi

# 4. Start
if [ "$NO_START" -eq 1 ]; then
  echo "✓ Scaffolded $DIR (--no-start). Run: cd $DIR && docker compose up -d"
  exit 0
fi
cd "$DIR"
[ "$NO_PULL" -eq 1 ] || docker compose pull
docker compose up -d
echo ""
echo "✓ OpenLDR is starting. Open https://localhost"
echo "  Keycloak admin password: $(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2)"
```

- [ ] **Step 2: Make it executable and lint (if shellcheck is available)**

```bash
chmod +x install/install.sh
command -v shellcheck >/dev/null 2>&1 && shellcheck install/install.sh || echo "shellcheck not installed — skipping"
```
Expected: no errors from shellcheck (if present).

- [ ] **Step 3: Dry-run verification (no image pull, no start)**

Run:
```bash
bash install/install.sh --dir /tmp/openldr-test --no-start
```
Expected: creates `/tmp/openldr-test` with `docker-compose.yml`, `config/`, `.env`, and a self-signed cert; prints the `--no-start` message. Then validate the compose interpolates:
```bash
cd /tmp/openldr-test && docker compose config >/dev/null && echo "compose OK"
```
Expected: `compose OK` (validates the compose file + `.env` substitution without pulling images).

- [ ] **Step 4: Clean up and commit**

```bash
rm -rf /tmp/openldr-test
git add install/install.sh
git commit -m "feat(install): install.sh one-line installer for Linux/macOS"
```

### Task 14: `install.ps1` (Windows)

**Files:**
- Create: `install/install.ps1`

- [ ] **Step 1: Create `install/install.ps1`**

```powershell
# OpenLDR CE one-line installer (Windows PowerShell).
#   irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.ps1 | iex
param(
  [string]$Dir = "./openldr",
  [string]$Version = "latest",
  [switch]$NoStart,
  [switch]$NoPull
)
$ErrorActionPreference = "Stop"
$RepoRaw = "https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main"

function Die($m) { Write-Error "X $m"; exit 1 }

# 1. Preflight
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed. See https://docs.docker.com/get-docker/" }
docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose plugin not found. Update Docker Desktop." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker daemon is not running. Start Docker Desktop and retry." }

# 2. Scaffold
Write-Host "-> Scaffolding $Dir"
New-Item -ItemType Directory -Force -Path "$Dir/config/nginx/certs","$Dir/config/keycloak" | Out-Null
function Fetch($rel, $out) { Invoke-WebRequest -UseBasicParsing "$RepoRaw/$rel" -OutFile $out }
Fetch "deploy/install/docker-compose.yml" "$Dir/docker-compose.yml"
Fetch "deploy/nginx/openldr.conf.template" "$Dir/config/nginx/openldr.conf.template"
Fetch "infra/keycloak/openldr-realm.json" "$Dir/config/keycloak/openldr-realm.json"
Fetch "scripts/init-target-db.sql" "$Dir/config/init-target-db.sql"

# 3. Secrets + cert (never overwrite an existing .env)
function Rand { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }) }
$envPath = "$Dir/.env"
if (-not (Test-Path $envPath)) {
  $pg = Rand; $kc = Rand; $s3k = Rand; $s3s = Rand
  @"
OPENLDR_VERSION=$Version
SERVER_NAME=localhost
PORT=3000
NODE_ENV=production
INTERNAL_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr
TARGET_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr_target
POSTGRES_PASSWORD=$pg
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$s3k
S3_SECRET_ACCESS_KEY=$s3s
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=http://host.docker.internal:8180/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$kc
"@ | Out-File -FilePath $envPath -Encoding ascii
  Write-Host "-> Wrote $envPath (generated secrets)"
} else {
  Write-Host "-> Reusing existing $envPath"
}

$cert = "$Dir/config/nginx/certs/fullchain.pem"
if (-not (Test-Path $cert)) {
  if (Get-Command openssl -ErrorAction SilentlyContinue) {
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout "$Dir/config/nginx/certs/privkey.pem" -out $cert `
      -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>$null
    Write-Host "-> Generated self-signed cert"
  } else {
    Write-Host "! openssl not found — provide certs in $Dir/config/nginx/certs/"
  }
}

# 4. Start
if ($NoStart) { Write-Host "OK Scaffolded $Dir (-NoStart). Run: cd $Dir; docker compose up -d"; exit 0 }
Push-Location $Dir
if (-not $NoPull) { docker compose pull }
docker compose up -d
Pop-Location
Write-Host ""
Write-Host "OK OpenLDR is starting. Open https://localhost"
```

- [ ] **Step 2: Verify script parses (Windows / PowerShell)**

Run (PowerShell):
```powershell
powershell -NoProfile -Command "$null = [ScriptBlock]::Create((Get-Content -Raw install/install.ps1)); Write-Host 'parse OK'"
```
Expected: `parse OK` (no parse errors).

- [ ] **Step 3: Dry-run (if a Docker-enabled Windows machine is available)**

Run (PowerShell):
```powershell
./install/install.ps1 -Dir "$env:TEMP/openldr-test" -NoStart
```
Expected: scaffolds the dir, `.env`, and cert; prints the `-NoStart` message. If no Windows/Docker machine is available, this step is deferred and noted — the parse check in Step 2 is the minimum bar.

- [ ] **Step 4: Commit**

```bash
git add install/install.ps1
git commit -m "feat(install): install.ps1 one-line installer for Windows"
```

### Task 15: Release documentation

**Files:**
- Create: `RELEASE.md`

- [ ] **Step 1: Create `RELEASE.md`**

```markdown
# Releasing OpenLDR CE

The one-line installer (`install/install.sh`, `install/install.ps1`) pulls the
app image from GHCR. Until an image is published, the installer scaffolds a
working directory but `docker compose pull` will fail — publish an image first.

## Build & push the app image

```
docker build -t ghcr.io/fmwasekaga/openldr:0.1.0 -t ghcr.io/fmwasekaga/openldr:latest .
echo "$GHCR_TOKEN" | docker login ghcr.io -u fmwasekaga --password-stdin
docker push ghcr.io/fmwasekaga/openldr:0.1.0
docker push ghcr.io/fmwasekaga/openldr:latest
```

The image tag maps to `OPENLDR_VERSION` in the installer's `.env`
(`--version 0.1.0` pins it; default `latest`).

## Verifying the installer end-to-end

After the first push:

```
bash install/install.sh --dir /tmp/openldr-e2e --version 0.1.0
```

Expected: the stack pulls, comes up healthy, and https://localhost serves the
studio SPA.

## Follow-up (Approach B)

Automate build + push + a GitHub release (with the compose bundle attached) via
GitHub Actions on tag push. Not yet implemented.
```

- [ ] **Step 2: Commit**

```bash
git add RELEASE.md
git commit -m "docs(install): release + image-publishing guide"
```

### Task 16: Final gate

- [ ] **Step 1: Full workspace build + typecheck**

Run:
```bash
pnpm install
pnpm build
pnpm typecheck
```
Expected: all packages build and typecheck (turbo cache can hide cross-package breakage — if anything looks off, re-run with `--force`).

- [ ] **Step 2: Landing + server tests**

Run:
```bash
pnpm --filter @openldr/web test
pnpm --filter @openldr/server test
```
Expected: PASS.

- [ ] **Step 3: e2e smoke (studio still served)**

Run:
```bash
pnpm e2e
```
Expected: PASS.

- [ ] **Step 4: No commit** (verification only). All slices complete.

---

## Self-Review Notes

- **Spec coverage:** Slice 1 (rename) → Tasks 1–4; Slice 2 (landing: hero/install/features/docs/footer, tokens reuse) → Tasks 5–11; Slice 3 (install.sh + install.ps1 + image-based compose + RELEASE.md) → Tasks 12–15; gate → Task 16. All spec sections covered.
- **Known limitation carried from spec:** full end-to-end installer verification is blocked on the first GHCR image publish (documented in `RELEASE.md`, Task 15, and verified as far as `docker compose config` in Task 13).
- **Adaptation points flagged:** copied `tabs.tsx`/`card.tsx` export names/APIs must be confirmed against the actual files (Tasks 8, 9) — the studio primitives are the source of truth.
```
