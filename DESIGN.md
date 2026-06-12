# Design System Inspired by Supabase — OpenLDR Edition

## 1. Visual Theme & Atmosphere

OpenLDR's design system channels the aesthetic of a premium code editor — deep black backgrounds (`#0f0f0f`, `#171717`) with steelblue accents (`#4682B4`, `#5A9BD6`) that reflect the clinical precision and trustworthiness expected in a Laboratory Information System.

The design is dark-mode-native but supports a light mode toggle. Depth is communicated through a sophisticated border hierarchy rather than shadows — borders at `rgba(46, 46, 46)`, surfaces at `rgba(41, 41, 41, 0.84)`, and accents at partial opacity all blend with the background to create a rich, dimensional palette.

The steelblue accent (`#4682B4`) appears selectively — in the OpenLDR logo, in link colors (`#5A9BD6`), and in border highlights (`rgba(70, 130, 180, 0.3)`) — always as a signal of "this is OpenLDR" rather than as a decorative element. Pill-shaped buttons (9999px radius) for primary CTAs contrast with standard 6px radius for secondary elements.

**Key Characteristics:**

- Dark-mode-native: near-black backgrounds (`#0f0f0f`, `#171717`) — never pure black
- Steelblue brand accent (`#4682B4`, `#5A9BD6`) used sparingly as identity marker
- Sans-serif system font stack (Inter or system default)
- Depth through border contrast and transparency — no box-shadows
- Rounded-md (6px) buttons for all CTAs — no pill/full-round buttons
- Neutral gray scale from `#171717` through `#898989` to `#fafafa`
- Border system using dark grays (`#2e2e2e`, `#363636`, `#393939`)
- Radix color primitives (crimson, amber, teal, slate) for semantic states

## 2. Color Palette & Roles

### Brand — Steelblue

- **OpenLDR Blue** (`#4682B4`): Primary brand color, logo, accent borders, active states
- **Blue Link** (`#5A9BD6`): Interactive blue for links and actions
- **Blue Light** (`#7BB3D9`): Hover states, lighter accent
- **Blue Border** (`rgba(70, 130, 180, 0.3)`): Subtle blue border accent
- **Blue Muted** (`rgba(70, 130, 180, 0.15)`): Background wash for active items
- **Blue Deep** (`#365F8A`): Pressed/active states on dark backgrounds

### Neutral Scale (Dark Mode)

- **Near Black** (`#0f0f0f`): Primary button background, deepest surface
- **Dark** (`#171717`): Page background, primary canvas
- **Dark Border** (`#242424`): Horizontal rule, section dividers
- **Border Dark** (`#2e2e2e`): Card borders, sidebar borders
- **Mid Border** (`#363636`): Button borders, dividers
- **Border Light** (`#393939`): Secondary borders
- **Charcoal** (`#434343`): Tertiary borders, dark accents
- **Dark Gray** (`#4d4d4d`): Heavy secondary text
- **Mid Gray** (`#898989`): Muted text, link color
- **Light Gray** (`#b4b4b4`): Secondary link text
- **Near White** (`#efefef`): Light border, subtle surface
- **Off White** (`#fafafa`): Primary text, button text

### Neutral Scale (Light Mode)

- **White** (`#ffffff`): Page background, primary canvas
- **Off White** (`#fafafa`): Card backgrounds, sidebar
- **Light Gray** (`#f4f4f5`): Muted surfaces, hover backgrounds
- **Border Light** (`#e4e4e7`): Card borders, dividers
- **Border** (`#d4d4d8`): Standard borders
- **Border Dark** (`#a1a1aa`): Prominent borders
- **Mid Gray** (`#71717a`): Muted text
- **Dark Gray** (`#3f3f46`): Secondary text
- **Near Black** (`#18181b`): Primary text

### Semantic Colors

- **Success**: `#22c55e` (green) — synced, passed QC, within range
- **Warning**: `#f59e0b` (amber) — pending, approaching TAT breach
- **Danger**: `#ef4444` (red) — critical/panic values, errors, failed QC
- **Info**: `#4682B4` (steelblue) — informational, links

### Surface & Overlay (Dark Mode)

- **Glass Dark** (`rgba(41, 41, 41, 0.84)`): Translucent dark overlay
- **Sidebar Surface** (`#1a1a1a`): Slightly lighter than page bg for sidebar
- **Card Surface** (`#1e1e1e`): Card and panel backgrounds

### Surface & Overlay (Light Mode)

- **Glass Light** (`rgba(255, 255, 255, 0.84)`): Translucent light overlay
- **Sidebar Surface** (`#fafafa`): Sidebar background
- **Card Surface** (`#ffffff`): Card and panel backgrounds

## 3. Typography Rules

### Font Families

- **Primary**: System font stack — `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Monospace**: `'JetBrains Mono', 'Fira Code', 'Source Code Pro', Menlo, monospace`

### Hierarchy

| Role            | Size             | Weight | Line Height | Notes                                    |
| --------------- | ---------------- | ------ | ----------- | ---------------------------------------- |
| Page Title      | 24px (1.50rem)   | 600    | 1.33        | Page headings                            |
| Section Heading | 18px (1.125rem)  | 600    | 1.40        | Section titles, card titles              |
| Sub-heading     | 16px (1.00rem)   | 500    | 1.50        | Secondary headings                       |
| Body            | 14px (0.875rem)  | 400    | 1.50        | Standard body text (desktop app default) |
| Nav Link        | 14px (0.875rem)  | 500    | 1.00        | Sidebar and navbar items                 |
| Button          | 14px (0.875rem)  | 500    | 1.14        | Button labels                            |
| Caption         | 13px (0.8125rem) | 400    | 1.33        | Metadata, table headers                  |
| Small           | 12px (0.75rem)   | 400    | 1.33        | Fine print, badges                       |
| Code            | 13px (0.8125rem) | 400    | 1.33        | Monospace, code snippets                 |

### Principles

- **14px base**: Desktop app default — denser than web, comfortable for data-heavy screens
- **Weight restraint**: 400 for body, 500 for interactive elements, 600 for headings only
- **No bold (700)** in the core system — hierarchy through size and weight 600 max
- **Monospace for data**: Patient IDs, order IDs, timestamps in monospace

## 4. Component Stylings

### Buttons

**Primary Pill (Dark Mode)**

- Background: `#4682B4` (steelblue)
- Text: `#ffffff`
- Padding: 8px 24px
- Radius: 9999px (full pill)
- Border: none
- Hover: `#5A9BD6`
- Active: `#365F8A`

**Primary Pill (Light Mode)**

- Background: `#4682B4`
- Text: `#ffffff`
- Padding: 8px 24px
- Radius: 9999px
- Hover: `#365F8A`

**Secondary Button**

- Background: transparent
- Text: `#fafafa` (dark) / `#18181b` (light)
- Padding: 8px 16px
- Radius: 6px
- Border: `1px solid #363636` (dark) / `1px solid #d4d4d8` (light)
- Hover: surface slightly lighter/darker

**Ghost Button**

- Background: transparent
- Text: `#898989` (dark) / `#71717a` (light)
- Padding: 8px
- Radius: 6px
- Border: none
- Hover: `rgba(70, 130, 180, 0.15)` background

### Cards & Containers

- Background: `#1e1e1e` (dark) / `#ffffff` (light)
- Border: `1px solid #2e2e2e` (dark) / `1px solid #e4e4e7` (light)
- Radius: 8px
- No shadows — borders define edges
- Internal padding: 16px–24px

### Sidebar

- Width: 240px (collapsible to 64px icon-only)
- Background: `#1a1a1a` (dark) / `#fafafa` (light)
- Border-right: `1px solid #2e2e2e` (dark) / `1px solid #e4e4e7` (light)
- Nav items: 14px weight 500, 8px 12px padding, 6px radius
- Active item: `rgba(70, 130, 180, 0.15)` background, `#5A9BD6` text (dark) / `#4682B4` text (light)
- Inactive item: `#898989` text (dark) / `#71717a` text (light)
- Hover: `rgba(255, 255, 255, 0.05)` (dark) / `rgba(0, 0, 0, 0.04)` (light)
- OpenLDR logo/wordmark at top
- User avatar + name at bottom

### Top Navbar

- Height: 48px
- Background: same as page background
- Border-bottom: `1px solid #2e2e2e` (dark) / `1px solid #e4e4e7` (light)
- Contains: breadcrumb/page title, search (future), notifications (future), theme toggle, user menu

### Tables (Audit log, patient lists, etc.)

- Header: `#1a1a1a` (dark) / `#f4f4f5` (light), 13px weight 500 uppercase
- Rows: alternating is optional — border-bottom separation preferred
- Row border: `1px solid #242424` (dark) / `1px solid #e4e4e7` (light)
- Row hover: `rgba(70, 130, 180, 0.08)`
- Cell padding: 12px 16px

### Badges / Status Pills

- Radius: 9999px
- Padding: 2px 10px
- Font: 12px weight 500
- Variants:
  - **Default**: `#2e2e2e` bg, `#898989` text (dark)
  - **Success**: `rgba(34, 197, 94, 0.15)` bg, `#22c55e` text
  - **Warning**: `rgba(245, 158, 11, 0.15)` bg, `#f59e0b` text
  - **Danger**: `rgba(239, 68, 68, 0.15)` bg, `#ef4444` text
  - **Info**: `rgba(70, 130, 180, 0.15)` bg, `#5A9BD6` text

## 5. Layout Principles

### Desktop App Layout

```
┌──────────────────────────────────────────────┐
│ Sidebar (240px)  │  Top Navbar (48px)        │
│                  │───────────────────────────│
│  [Logo]          │                           │
│                  │   Page Content             │
│  Dashboard       │                           │
│  Patients        │                           │
│  Orders          │                           │
│  Results         │                           │
│  QC              │                           │
│  Reports         │                           │
│  Audit Log       │                           │
│                  │                           │
│  ─────────       │                           │
│  Settings        │                           │
│  [User]          │                           │
└──────────────────────────────────────────────┘
```

### Spacing System

- Base unit: 4px
- Scale: 2px, 4px, 6px, 8px, 12px, 16px, 20px, 24px, 32px, 48px
- Page content padding: 24px
- Sidebar item gap: 2px
- Card internal padding: 16px–24px

### Border Radius Scale

- Small (4px): Inputs, small elements
- Standard (6px): Buttons, sidebar items, badges
- Comfortable (8px): Cards, containers, panels
- Pill (9999px): Primary CTA buttons, status badges

## 6. Depth & Elevation

| Level       | Treatment (Dark)                 | Treatment (Light)             | Use               |
| ----------- | -------------------------------- | ----------------------------- | ----------------- |
| Flat (L0)   | Border `#2e2e2e`                 | Border `#e4e4e7`              | Default surfaces  |
| Subtle (L1) | Border `#363636`                 | Border `#d4d4d8`              | Interactive/hover |
| Accent (L2) | Border `rgba(70,130,180,0.3)`    | Border `rgba(70,130,180,0.4)` | Brand-highlighted |
| Focus       | `0 0 0 2px rgba(70,130,180,0.5)` | Same                          | Focus rings only  |

**No box-shadows** except focus rings. Depth through borders.

## 7. Do's and Don'ts

### Do

- Use near-black backgrounds (`#0f0f0f`, `#171717`) in dark mode — never pure black
- Apply steelblue (`#4682B4`, `#5A9BD6`) sparingly — it's an identity marker, not decoration
- Create depth through border color differences (`#242424` → `#2e2e2e` → `#363636`)
- Use pill shape (9999px) for primary CTAs and status badges
- Use 14px as the base body text size (desktop app density)
- Support both dark and light modes with proper token mapping
- Use monospace for IDs, timestamps, and code

### Don't

- Don't add box-shadows — use borders for depth
- Don't use bold (700) — max weight is 600 for headings
- Don't apply steelblue to large background surfaces — it's for borders, links, and small accents
- Don't lighten dark mode backgrounds above `#1e1e1e` for primary surfaces
- Don't use green as brand color — green is reserved for success/sync states only
