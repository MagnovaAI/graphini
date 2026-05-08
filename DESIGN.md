---
version: 1.0
name: Graphini
description: "A dense dark IDE-style canvas built around #181818 with #141414 sidebar/chat and #1c1c1c surface lifts. Type runs Inter for UI and JetBrains Mono for code. Body is hard-locked at 13px on a 4px spacing grid. The single chromatic accent is frosty cyan-blue #88c0d0, used only on the brand mark, focus rings, links, and the primary CTA. Hierarchy comes from layered neutral surfaces and 1px hairlines, never from shadow. The system reads as a developer workspace: tight, technical, quiet."

source-of-truth: src/app.css
implementation-notes:
  - Tokens live as CSS custom properties in src/app.css under the `--ds-*` prefix.
  - Legacy shadcn names (`--background`, `--foreground`, `--primary`, etc.) map onto the design system in both `:root` (light) and `.dark` (dark) blocks.
  - This file documents the dark theme as canonical. Light mode is supported but not the design driver.

colors:
  # Surface ladder (dark)
  background: "#181818"        # default page background
  chat-background: "#141414"   # chat scroll surface and sidebar
  surface-lifted: "#1c1c1c"    # tool boxes, user message bubble, hovered states
  popover: "#1c1c1c"           # menus, dropdowns
  chat-input-bg: "#1c1c1c"     # the prompt input frame
  code-bg: "#181818"            # inline and block code surfaces

  # Text
  foreground: "#e4e4e4"
  muted-foreground: "rgba(228, 228, 228, 0.55)"

  # Hairlines
  border: "#262626"
  input-border: "#262626"

  # Accent (used scarcely)
  primary: "#88c0d0"
  on-primary: "#181818"
  ring: "#88c0d0"

  # Semantic
  destructive: "#e34671"
  warning: "#f1b467"
  success: "#3fa266"
  info: "#88c0d0"

typography:
  display-xl:
    fontFamily: Inter
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -3.0px
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1.8px
  display-md:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -1.0px
  headline:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.6px
  card-title:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.4px
  subhead:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.2px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.1px
  body:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  caption:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  button:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0
  eyebrow:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0.4px
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

control-heights:
  sm: 24px   # h-6  — chip / badge
  md: 28px   # h-7  — icon button, model trigger
  lg: 32px   # h-8  — primary CTA, send button
  xl: 40px   # h-10 — multi-line input min-height

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
    height: "{control-heights.lg}"
  button-secondary:
    backgroundColor: "{colors.surface-lifted}"
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
    height: "{control-heights.lg}"
    border: "1px solid {colors.border}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
    height: "{control-heights.md}"
    hoverBackgroundColor: "rgba(228, 228, 228, 0.10)"
  icon-button:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    size: "{control-heights.md}"
    hoverBackgroundColor: "rgba(228, 228, 228, 0.10)"
    hoverTextColor: "{colors.foreground}"
  text-input:
    backgroundColor: "{colors.chat-input-bg}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 12px 12px
    border: "1px solid rgba(38, 38, 38, 0.5)"
    focusBorderColor: "rgba(228, 228, 228, 0.30)"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 16px
    border: "1px solid {colors.border}"
  tool-box:
    backgroundColor: "{colors.surface-lifted}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
    border: "1px solid rgba(38, 38, 38, 0.4)"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.foreground}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  user-message-bubble:
    backgroundColor: "{colors.surface-lifted}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 8px 12px
  status-badge:
    backgroundColor: "{colors.surface-lifted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
    height: "{control-heights.sm}"
  attachment-chip:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0 8px
    height: 32px
    border: "1px solid {colors.border}"
---

## Overview

The Graphini design system is a dense dark workspace. The page sits on `{colors.background}` (#181818). Sidebar and chat area sit one shade darker at `{colors.chat-background}` (#141414). Lifted surfaces — tool boxes, user message bubbles, popovers, the prompt input — sit one shade lighter at `{colors.surface-lifted}` (#1c1c1c). Hairline borders run at `{colors.border}` (#262626).

The single chromatic accent is **frosty cyan-blue** `{colors.primary}` (#88c0d0). It appears only on:
- The brand mark
- Primary CTAs
- Focus rings and selection highlights
- Link emphasis

It does **not** appear on card fills, section backgrounds, or decorative gradients. Semantic colors (`{colors.destructive}`, `{colors.warning}`, `{colors.success}`) are reserved for status pills and inline state.

Type runs **Inter** for all UI (display through caption) and **JetBrains Mono** for code. Body is hard-locked at 13px across the entire app — chat, sidebar, badges, captions, buttons, line numbers, status pills all sit at 13px. Headings step from 18px up to 80px on the `body-lg → display-xl` ladder.

Spacing follows the **4px grid**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 96. Half-steps (2 / 6 / 10 / 14 px) are forbidden. Tailwind's whole-number scale (`gap-1`, `p-2`, `mt-3`, etc.) maps cleanly; `*-0.5`, `*-1.5`, `*-2.5`, `*-3.5` are not used.

**Key Characteristics:**
- Three-step surface ladder: `chat-background` (#141414) → `background` (#181818) → `surface-lifted` (#1c1c1c).
- Frosty cyan accent (#88c0d0) used scarcely — never as a fill.
- Inter for everything UI; JetBrains Mono for code at 12px.
- Body hard-locked at 13px. Heading ladder: 18 / 20 / 22 / 28 / 40 / 56 / 80.
- 4px spacing grid only — no fractional Tailwind steps.
- Cards use `{rounded.lg}` 12px corners with 1px hairline borders.
- No drop shadows on surfaces. Hierarchy comes from surface lift and hairlines.

## Colors

> Source: `.dark` block in `src/app.css`. Light mode tokens live in `:root` and use shadcn defaults — they are not the design driver.

### Surface

- **background** (#181818): Default page background, cards, the editor panel.
- **chat-background** (#141414): Chat scroll surface and sidebar.
- **surface-lifted** (#1c1c1c): Tool output boxes, user message bubbles, popovers, the prompt input frame, hovered cards.
- **chat-input-bg** (#1c1c1c): The prompt input. Same value as `surface-lifted` but tokenized separately so it can diverge later.
- **code-bg** (#181818): Code blocks, line-number gutters.
- **popover** (#1c1c1c): Dropdown menus, the model picker, tooltips.

### Text

- **foreground** (#e4e4e4): Primary body and headlines.
- **muted-foreground** (rgba(228,228,228,0.55)): Secondary text, captions, icon defaults, subtitles.

### Hairlines

- **border** (#262626): All 1px borders — cards, inputs, dividers, side rails.

### Accent

- **primary** (#88c0d0): Brand mark, primary CTA, focus ring, link emphasis. Never a fill.
- **on-primary** (#181818): Text on the lavender CTA — the page background reversed onto cyan.

### Semantic

- **destructive** (#e34671): Errors, destructive confirmations, delete affordances.
- **warning** (#f1b467): Cautions, modified state.
- **success** (#3fa266): Validation passed, status OK.
- **info** (#88c0d0): Informational pills (same as `primary`).

## Typography

### Font Family

- **Inter** — single sans family for all UI: chrome, headings, body, buttons, badges. Self-hosted variable woff2 (optical-size axis) at `static/fonts/Inter-Variable.woff2`. Fallback stack: `'SF Pro Display', -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif`.
- **JetBrains Mono** — code, line numbers, IDs. Self-hosted variable woff2 at `static/fonts/JetBrainsMono-Variable.woff2`. Fallback: `ui-monospace, 'SF Mono', Menlo, monospace`.

A single sans family carries display through caption — the family change between display and body is silent. Inter's optical-size axis adjusts proportions automatically across sizes.

### Hierarchy

**Body is hard-locked at 13px across the entire app.** No 11/12px caption tier, no 14/16px body tier — chat, sidebar, settings, badges, line numbers, status pills all sit at 13px. Mono code drops to 12px to match line-density expectations of code surfaces. Heading tiers (≥18px) keep their natural scale.

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 80px | 600 | 1.05 | -3.0px | Largest hero headline (landing only) |
| `{typography.display-lg}` | 56px | 600 | 1.10 | -1.8px | Section opener headlines |
| `{typography.display-md}` | 40px | 600 | 1.15 | -1.0px | Sub-section, chat empty-state hero |
| `{typography.headline}` | 28px | 600 | 1.20 | -0.6px | Pricing/feature tier titles |
| `{typography.card-title}` | 22px | 500 | 1.25 | -0.4px | Feature card titles, prose `h1` |
| `{typography.subhead}` | 20px | 400 | 1.40 | -0.2px | Lead paragraphs, prose `h2` |
| `{typography.body-lg}` | 18px | 400 | 1.50 | -0.1px | Lead body, prose `h3` |
| `{typography.body}` | 13px | 400 | 1.50 | 0 | **Default body — every chat/UI surface.** |
| `{typography.body-sm}` | 13px | 400 | 1.50 | 0 | Same as body (kept for token aliasing) |
| `{typography.caption}` | 13px | 400 | 1.40 | 0 | Captions, meta, status |
| `{typography.button}` | 13px | 500 | 1.20 | 0 | All button labels |
| `{typography.eyebrow}` | 13px | 500 | 1.30 | 0.4px | Section eyebrow (positive tracking, uppercase) |
| `{typography.mono}` | 12px | 400 | 1.50 | 0 | JetBrains Mono for code, line numbers, IDs |

### Principles

- **Body hard-locked at 13px.** The whole UI sits on one body tier. Headings (≥18px) keep their natural scale.
- **Mono drops to 12px** for code density. Mono is the only token below the body lock.
- **Aggressive negative tracking on display** (-3.0px at 80px ≈ 4% of size).
- **One family from display to body.** Inter at weight 600 for display, 500 for card titles, 400 for body. Resist 700+ display weights.
- **Eyebrow uses positive tracking** (+0.4px) and uppercase — contrast against negative-tracked display marks taxonomy.
- **Mono only in code contexts.** JetBrains Mono lives inside code blocks, line numbers, inline `code`, and identifier tokens. Never on UI chrome.

## Layout

### Spacing System

- **Base unit**: 4px.
- **Whole-number scale only**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 96 px.
- **Half-steps forbidden**: do not use `gap-0.5`, `gap-1.5`, `gap-2.5`, `gap-3.5`, or any `[Npx]` value off the 4px grid.
- Tailwind whole numbers map cleanly: `gap-1` = 4px, `gap-2` = 8px, `gap-3` = 12px, `gap-4` = 16px, `gap-6` = 24px, `gap-8` = 32px, `gap-12` = 48px, `gap-24` = 96px.

### Control heights

- **24px / `h-6`**: chip, badge, status pill.
- **28px / `h-7`**: icon button, model picker trigger, single-line dense control.
- **32px / `h-8`**: primary CTA, send button.
- **40px / `h-10`**: multi-line text input min-height.

### Container

- Chat content max-width: `max-w-3xl` (768px).
- Sidebar width: collapsed icon rail vs expanded panel.
- Editor panel: full-bleed within its column.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow, no border | Default for body type, hero text |
| 1 (lifted) | `surface-lifted` (#1c1c1c) on `background` (#181818) | Tool boxes, user bubbles, hovered cards |
| 2 (popover) | `popover` (#1c1c1c), 1px `border` | Dropdowns, model picker |
| Focus | 2px `primary` (#88c0d0) outline at 50% opacity, 2px offset | Focused buttons, focused inputs |

Depth is carried by the surface ladder and 1px hairlines. We resist drop shadows on dark almost entirely — the only place they appear is on absolute popovers (Popover.Content) where the elevation needs to read against an arbitrary parent.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Small chips, status badges, inline tags |
| `{rounded.sm}` | 6px | Inline tags |
| `{rounded.md}` | 8px | All buttons, form inputs, attachment chips |
| `{rounded.lg}` | 12px | Cards, code blocks, message bubbles, prompt input frame |
| `{rounded.xl}` | 16px | Large feature panels (rare) |
| `{rounded.xxl}` | 24px | Hero CTAs (rare) |
| `{rounded.pill}` | 9999px | Status pills, segmented controls |
| `{rounded.full}` | 9999px | Avatars, send button |

## Components

See `components:` block in the front matter for token references. Notable patterns:

- **Icon buttons**: 28px (`h-7`) square, transparent, hover bg `rgba(228,228,228,0.10)`. Used for Paperclip, Mic, Improve, etc. in the prompt toolbar.
- **Primary CTA**: 32px (`h-8`), cyan fill, `on-primary` text, `rounded-md`.
- **Send button**: 32px, white-on-dark fill (`bg-foreground`), rounded-full.
- **User message bubble**: `surface-lifted`, `rounded-lg`, padding `8px 12px`.
- **Tool box** (expanded reasoning, code preview): `surface-lifted`, `rounded-md`, 1px hairline, padding `12px`.
- **Attachment chip** (input + chat history rendered the same): `background`, 1px `border`, `rounded-md`, 32px tall, FileText icon, filename, ext badge in muted gray.
- **Prompt input frame**: `chat-input-bg`, 1px border at 50% opacity, `rounded-2xl`, focus tightens border to `rgba(228,228,228,0.30)`.

## Do's and Don'ts

### Do

- Reserve `chat-background` (#141414) for the chat scroll area and sidebar — they are the primary "ambient" surface.
- Use `surface-lifted` (#1c1c1c) for everything that needs to sit visibly on top: tool boxes, user bubbles, popovers, the prompt input.
- Use `primary` cyan (#88c0d0) ONLY for: brand mark, primary CTA, focus ring, link emphasis.
- Use the three-step surface ladder for hierarchy. No skipped levels.
- Pair display weight 600 with body weight 400.
- Apply negative letter-spacing aggressively on display.
- Ship `text-[13px]` everywhere body or smaller would normally appear.
- Use Tailwind whole-number spacing only (`gap-1`, `p-2`, `mt-3` ...).

### Don't

- Don't use `#000000` true black anywhere — `#181818` is the floor.
- Don't use cyan as a section background or card fill.
- Don't introduce a second chromatic accent (orange, pink, green, purple) on chrome. Diagram canvas color palette is exempt — that's content.
- Don't add atmospheric gradients or spotlight cards.
- Don't pill-round CTAs.
- Don't use half-step Tailwind spacing (`gap-1.5`, `py-2.5`, `mt-0.5`, etc.).
- Don't introduce a 12px caption tier or a 14/16px body tier — body is hard-locked at 13px.
- Don't use `font-mono` on UI chrome.

## Iteration Guide

1. Focus on ONE component at a time and reference it by its `components:` token name.
2. When introducing a new surface, decide first which step of the ladder it sits on (`chat-background` / `background` / `surface-lifted`).
3. Default body to `{typography.body}` at 13px / weight 400. Body is hard-locked at 13px — do not introduce a 12px caption tier or a 14/16px body tier.
4. Default mono to `{typography.mono}` at 12px / weight 400. Only used for code, line numbers, identifiers.
5. Use 4px-grid spacing only — no half-steps.
6. Add new variants as separate component entries; reference existing ones via the `{tokens}` syntax.
7. Treat cyan as scarce: brand mark, primary CTA, focus ring, link emphasis. Never as a card fill or section background.
8. CSS tokens live in `src/app.css` under `--ds-*` prefixes. Legacy shadcn names (`--background`, `--foreground`, `--primary`, ...) map onto the system. Never inline a hex value — reference a token.
9. Font files live at `static/fonts/Inter-Variable.woff2` and `static/fonts/JetBrainsMono-Variable.woff2`. Both are preloaded in `app.html`.

## Known Gaps

- **Light mode** uses shadcn defaults rather than a derived light palette of this system. The dark theme is the canonical implementation and the design driver.
- **Form-field error and validation styling** is not yet locked.
- **The diagram canvas** uses a richer color palette (red, orange, yellow, green, blue, purple) for node fills, edge highlights, and category tags — those colors live inside the diagram surface and are intentionally not part of the chrome system.
- **`--ds-*` tokens are exposed but most components still resolve through the legacy shadcn names** (`bg-background`, `text-foreground`, `border-border`, etc.) which now map onto the design system. New components should prefer the `--ds-*` tokens directly when a precise shade is needed.
