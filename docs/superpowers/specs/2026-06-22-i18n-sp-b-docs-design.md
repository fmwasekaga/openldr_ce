# i18n SP-B — Docs Translation (en/fr/pt) Design

**Date:** 2026-06-22
**Status:** Approved for planning
**Context:** Second of the two i18n sub-projects. SP-A (merged `383d7f7`) localized the app UI + added the language switcher. SP-B localizes the in-app **documentation** and makes it follow the app-language switcher. It also refines the SP-A switcher into a submenu.

## 1. Goal

The 9 in-app doc pages render in en/fr/pt, following the app-language switcher (no separate docs language control), with per-doc English fallback. Plus: the SP-A language switcher in the user dropdown becomes a "Language ▸" submenu.

## 2. Resolved decisions

- **Docs follow the app switcher; drop the docs-only selector.** Docs render in the SP-A app language; remove the EN/FR/PT `Select` in the docs toolbar and the independent `useDocLocale` hook.
- **Switcher → submenu.** The three flat language `DropdownMenuItem`s in the AppShell user dropdown become a `DropdownMenuSub` ("Language ▸" → English / Français / Português).
- **Screenshots stay en;** internal `docs/superpowers/*` dev docs and server/CLI strings are out of scope.

## 3. Current state (already built — SP-B reuses)

- `apps/web/src/docs/registry.ts`: **fully locale-aware** — `Locale = 'en'|'fr'|'pt'`, globs `./0.1.0/*/*.md` eagerly into `BY_VERSION[version][locale][slug]`, `resolve(locale, slug)` returns localized content **or falls back to en per-doc** (`localeUsed` tracks which), `list(locale)` over `DOC_ORDER`. **No registry change needed** — adding `fr/`+`pt/` dirs auto-registers.
- `DOC_ORDER` (9 slugs): `overview, getting-started, dashboard, reports, ingestion, terminology, dhis2, external-db, cli`. Only `apps/web/src/docs/0.1.0/en/*.md` exists today.
- `apps/web/src/pages/Docs.tsx`: uses `useDocLocale()` (independent), renders an EN/FR/PT `Select` in the toolbar, calls `list(locale)`/`resolve(locale, slug)`, shows a "Shown in English — not yet translated." notice when `section.localeUsed !== locale`, and a locale-aware search (`buildIndex(sections)` rebuilds via `useMemo` on `sections`).
- `apps/web/src/docs/useDocLocale.ts`: own `openldr-docs-locale` localStorage key, default en. **Becomes dead** under SP-B.
- `apps/web/src/shell/AppShell.tsx` (SP-A): user dropdown has 3 flat language `DropdownMenuItem`s from `SUPPORTED_LANGUAGES` (lines ~113–116). `DropdownMenuSub`/`DropdownMenuSubTrigger`/`DropdownMenuSubContent` primitives exist in `components/ui/dropdown-menu.tsx`.
- SP-A `i18n/language.ts`: `SUPPORTED_LANGUAGES` (en/fr/pt), `getStoredLanguage`, `setLanguage`. App language values exactly match `Locale`.

## 4. Design

### 4.1 Docs follow the app language
- In `Docs.tsx`, replace `const [locale, setLocale] = useDocLocale();` with deriving the locale from the app i18n language:
  ```ts
  const { i18n } = useTranslation();
  const locale: Locale = (['en','fr','pt'] as const).includes(i18n.language as Locale) ? (i18n.language as Locale) : 'en';
  ```
  `useTranslation()` re-renders on `changeLanguage`, so the docs re-render in the new language automatically.
- Remove the docs-toolbar language `Select` and its imports (`Select*`, `LOCALES`) from `Docs.tsx`. Keep the export menu, search, collapse, and the per-doc fallback notice (`section.localeUsed !== locale`).
- Delete `apps/web/src/docs/useDocLocale.ts` and its test (now dead). `LOCALES` stays exported from the registry (still used internally / by the fallback logic) — only its use in the removed select goes away.

### 4.2 fr/ + pt/ markdown translations
- Create `apps/web/src/docs/0.1.0/fr/<slug>.md` and `apps/web/src/docs/0.1.0/pt/<slug>.md` for all 9 `DOC_ORDER` slugs (18 files), translated from the `en/` originals.
- **Preserve verbatim:** fenced code blocks, inline code, CLI commands, config/env keys, URLs, image references (`![…](…)` — screenshots stay en, same paths), markdown structure (heading levels, lists, tables, links). **Translate:** prose, and the leading `#` H1 (the registry uses `firstHeading` as the page title + nav label, so a translated H1 gives a translated nav entry).
- **Do not translate** proper nouns / product names: OpenLDR, DHIS2, LOINC, SNOMED, RxNorm, WHONET, FHIR, Keycloak, GLASS, MinIO, Postgres.
- Clinical/AMR/domain terms translated best-effort; a native-speaker review is a follow-up (consistent with SP-A's `// review` posture, though markdown carries no inline marker).

### 4.3 Switcher → submenu (refines SP-A)
- In `AppShell.tsx`, replace the three flat language `DropdownMenuItem`s with a submenu:
  ```tsx
  <DropdownMenuSub>
    <DropdownMenuSubTrigger>{t('layout.language')}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      {SUPPORTED_LANGUAGES.map((l) => (
        <DropdownMenuItem key={l.code} onClick={() => void setLanguage(l.code)} disabled={i18n.language === l.code}>
          {l.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuSubContent>
  </DropdownMenuSub>
  ```
- Import `DropdownMenuSub`/`DropdownMenuSubTrigger`/`DropdownMenuSubContent` in `AppShell.tsx`.
- Add `layout.language: 'Language'` to `en.ts` (+ fr `'Langue'`, pt `'Idioma'`) — a new key in all three bundles (parity enforced by `EnShape`).

## 5. Testing

- `registry.test.ts` (extend or add): with fr/pt files present, `resolve('fr', 'overview')` returns fr content (`localeUsed: 'fr'`); `resolve('fr', <slug-with-no-fr>)` falls back to en (`localeUsed: 'en'`) — but since SP-B translates ALL slugs, fallback is tested with a synthetic missing slug or by asserting all 9 fr/pt resolve. `list('fr')` returns 9 sections with French titles.
- `Docs.test.tsx`: drop the locale-`Select` interaction; assert the active locale follows the app language (mock/​set `i18n.language = 'fr'` → a French doc title renders; default en renders English). The fallback notice shows only when `localeUsed !== locale`.
- Remove `useDocLocale.test.ts`.
- `AppShell` switcher test (extend the SP-A submenu test): the language items now live under a "Language" submenu trigger; open the submenu, click Français → `setLanguage('fr')`. (Radix submenu open in jsdom: assert the items are reachable; adapt the open mechanism as the existing dropdown test does.)
- A doc-content sanity test: each fr/pt file is non-empty and starts with an `#` H1 (cheap structural guard against truncated translations).

## 6. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` — green (the new `layout.language` key is parity-enforced across en/fr/pt by `EnShape`). Re-run `@openldr/web#test` in isolation if it flakes. Manual: switch language in the user-dropdown submenu → the Docs page renders in that language; untranslated pages (none, post-SP-B) would show the fallback notice.

## 7. Out of scope

Localized screenshots, translating `docs/superpowers/*` dev specs/plans, server/CLI string localization, doc versions other than `0.1.0`, RTL.

## 8. Risks / notes

- **Translation volume:** 18 markdown files (9 slugs × fr/pt). The bulk of SP-B; structural-guard test catches truncation.
- **`useDocLocale` removal** is a clean deletion (its only consumer is `Docs.tsx`, rewired in 4.1). Confirm no other importer before deleting (`grep -rn useDocLocale apps/web/src`).
- **Image paths in translated markdown** must match the en originals exactly (screenshots are shared, en-only) — copy the image-reference lines verbatim.
- **Docs export** (md/pdf/docx) operates on the resolved `section.content`, so it exports in the active language automatically — no change needed.
