# i18n SP-A — UI Internationalization (en/fr/pt) Design

**Date:** 2026-06-22
**Status:** Approved for planning
**Context:** P1-UI-4 / P1-NFR-4 require the UI in en/fr/pt. Today `apps/web` has react-i18next wired with only an `en` bundle, no language switcher, and some still-hardcoded strings. This is the first of two i18n sub-projects: **SP-A = app UI i18n** (this doc); **SP-B = docs translation** (separate, builds on SP-A's language state).

## 1. Goal

The `apps/web` UI fully renders in English, French, and Portuguese, with a user-selectable language that persists across reloads. Frontend-only.

## 2. Resolved decisions

- **Translations:** full fr + pt bundles produced now (every UI key), clinical/AMR terms marked for a later native-speaker review. en is the fallback only for future-added keys.
- **Switcher:** in the user dropdown at the sidebar bottom (next to Settings/Sign out); `i18n.changeLanguage` + `localStorage` persist + restore-on-init; default `en`; no browser auto-detect.
- **Locale file split:** `i18n/index.ts` (one growing object, ~278 keys) is split into per-language files (`en.ts`/`fr.ts`/`pt.ts`) wired by `index.ts` — 3×278 keys in one file is unmaintainable.
- **Docs out of scope** here (SP-B).

## 3. Current state

- `apps/web/src/i18n/index.ts`: a single `const en = { … }` (~278 keys, nested namespaces: `common`, `table`, `users`, `dhis2`, `settings`, `layout`, …) + `i18n.use(initReactI18next).init({ resources: { en: { translation: en } }, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } })`. No detector, no persistence.
- 27 page files consume `useTranslation()`/`t()`. Interpolation uses `{{name}}` placeholders (e.g. `errorToast: 'Failed: {{error}}'`, `consentTitle: 'Review & approve: {{id}}'`).
- **Hardcoded (non-`t`) user-facing strings** confirmed in `apps/web/src/shell/AppShell.tsx`: the `NAV` `label`s (`Dashboard`/`Reports`/`Terminology`/`Forms`/`Users`/`Audit`/`Docs`), and aria/title literals (`Expand sidebar`/`Collapse sidebar`, `Switch to light mode`/`Switch to dark mode`, `Light mode`/`Dark mode`). Others may exist across pages/dialogs/components — an audit (Task 1) enumerates them.
- No `changeLanguage`/`LanguageSwitcher` anywhere in `apps/web/src`.

## 4. Design

### 4.1 Locale file split (refactor, behavior-preserving)
- Move the existing `en` object to `apps/web/src/i18n/en.ts` (`export const en = { … } as const`).
- `apps/web/src/i18n/index.ts` imports `en` (and later `fr`/`pt`), keeps the `i18n.use(initReactI18next).init(...)` call. Add a `type Resources = typeof en` so `fr`/`pt` can be typed against it for parity.
- This is a pure move — no key/behavior change; the existing 443 web tests stay green.

### 4.2 Extract remaining hardcoded strings (Task 1 audit → keys)
- Audit `apps/web/src` for user-facing literals not behind `t()`: JSX text nodes, `aria-label`, `title`, `placeholder`, `alt`, button/label text. Tooling: grep for `aria-label="`, `title="`, `placeholder="`, and review the shell + any pages flagged.
- Extract each into a key under a sensible namespace: `nav.*` for the sidebar labels, `a11y.*` for aria/title strings (e.g. `a11y.expandSidebar`, `a11y.collapseSidebar`, `a11y.switchToLight`, `a11y.switchToDark`), reusing existing namespaces where natural. Replace the literal with `t('…')`.
- The `NAV` array in `AppShell.tsx` becomes label-key-based (`labelKey: 'nav.dashboard'`), rendered with `t(item.labelKey)` — mirroring the `SettingsShell` `SUB_NAV` pattern already in the repo.
- Scope guard: only **user-facing** strings. Leave dev/log/test/`data-testid` literals alone.

### 4.3 fr + pt bundles
- `apps/web/src/i18n/fr.ts` and `pt.ts`: objects with the **identical key structure** as `en` (including the Task 1 additions), every value translated. `export const fr: typeof en = { … }` / `export const pt: typeof en = { … }` — the `typeof en` annotation makes TypeScript fail the build on any missing/extra/misshaped key (compile-time parity).
- Placeholders (`{{error}}`, `{{id}}`, `{{username}}`, etc.) preserved verbatim in every translation.
- Clinical/AMR/technical terms that a native speaker should verify get a trailing `// review` comment on the line (e.g. antibiogram, first-isolate, resourceType names, "specimen-origin").
- `index.ts` init becomes `resources: { en: { translation: en }, fr: { translation: fr }, pt: { translation: pt } }`.

### 4.4 Language switcher + persistence
- `apps/web/src/i18n/language.ts`: `const STORAGE_KEY = 'openldr.lang'`; `getStoredLanguage()` (reads localStorage, validates ∈ {en,fr,pt}, default `en`); `setLanguage(lng)` (`i18n.changeLanguage(lng)` + `localStorage.setItem`).
- `index.ts`: after `init`, call `i18n.changeLanguage(getStoredLanguage())` (or pass `lng: getStoredLanguage()` into init) so the saved language is restored on load.
- `AppShell.tsx` user dropdown: a language sub-section — three `DropdownMenuItem`s (or a small inline group) labelled `English` / `Français` / `Português`, each calling `setLanguage(lng)`; the current one marked (check icon / disabled). Placed above Sign out, near the Settings item. (Use existing `DropdownMenu` primitives; a separator between language and Sign out.)

## 5. Testing

- `i18n/parity.test.ts`: assert `Object.keys`-deep parity — `fr` and `pt` have exactly the same (recursively flattened) key set as `en`; no missing, no extra. (The `typeof en` annotation already enforces this at compile time; the test is a runtime backstop + a clear failure message.)
- `language.test.ts`: `getStoredLanguage` defaults to `en`, validates the stored value, rejects junk; `setLanguage` persists + calls `changeLanguage`.
- `AppShell` test extension: the dropdown exposes the three languages; selecting `Français` calls `setLanguage('fr')` (mock) / changes `i18n.language`; the NAV renders label keys (assert via the translated text for the active language).
- A representative page test asserting a `fr` string renders after `changeLanguage('fr')` (pick one already-tested page, e.g. the marketplace or a DHIS2 page).
- The locale-split refactor (4.1) must keep all existing web tests green.

## 6. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` (the `typeof en` annotations make the build fail on any fr/pt key drift). Re-run `@openldr/web#test` in isolation if it flakes. Manual: switch language in the running app, confirm persistence across reload.

## 7. Out of scope

Docs markdown translation (SP-B), server/CLI string localization, browser-language auto-detection, RTL, number/date locale formatting beyond what react-i18next gives by default.

## 8. Risks / notes

- **Translation quality:** machine-grade fr/pt produced now; clinical terms `// review`-flagged for a native pass. This satisfies the PRD's en/fr/pt requirement structurally + functionally; a review pass is a follow-up, not a blocker.
- **Key parity is enforced two ways** (compile-time `typeof en` + runtime parity test) so fr/pt can't silently drift from en as future keys are added.
- **Locale split is a prerequisite** (Task 1/2) and must be behavior-preserving — do it as its own commit with the full suite green before adding fr/pt.
- **Hardcoded-string audit completeness:** the audit is bounded to user-facing strings; if a few are missed they simply stay English (en-fallback behavior) — not a correctness break, a polish gap to sweep later.
