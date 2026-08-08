---
name: Quality Bar
description: Calm, exact, fast operational CI for one owner monitoring evaluations.
colors:
  sage-canvas: "#d7dbd2"
  ink: "#0f1410"
  muted-slate: "#545a54"
  line: "#b9bebb"
  focus: "#0f1410"
typography:
  display:
    fontFamily: "Inter, Aeonik, Helvetica Neue, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2.4vw, 1.9rem)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Aeonik, Helvetica Neue, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Inter, Aeonik, Helvetica Neue, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.06em"
rounded:
  sm: "8px"
  md: "10px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sage-canvas}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.sage-canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  header:
    backgroundColor: "{colors.sage-canvas}"
    textColor: "{colors.ink}"
  stat:
    backgroundColor: "{colors.sage-canvas}"
    textColor: "{colors.ink}"
---

# Design System: Quality Bar

## 1. Overview

**Creative North Star: "The Operational Ledger"**

Quality Bar is the quiet console for an owner/operator glancing at a 27" monitor in a calm, well-lit room to confirm the system is working. The vibe is monochrome and flat — like an old LCD screen without the pixels: pale sage canvas, near-black ink, layered greys, 1px rules, compact rows, no shadows, no elevation. Text is the primary carrier; geometry (square system phases vs circular custom Reviews) and connectors are supplemental, never the only meaning.

It explicitly rejects generic SaaS/inbox dashboards with Needs attention queues, pill badges, sidebars, persistent attention panels; neon/glassmorphism/gradients/gradient text; marketing heroes with big-number hero metrics; and identical card grids or modal-first flows.

**Key Characteristics:**
- One chronological ledger grouped by local day, newest first — operational calm over inbox urgency
- System (square) vs configured Review (circle) legible at a glance, stable order `reviews.id ASC, review_runs.id ASC`
- Truthful metrics with explicit `No data`/`—`, never fabricated zeros or progress
- Keyboard-first, visible `:focus-visible` near-black ring, `prefers-reduced-motion` respected

## 2. Colors

Monochrome sage/ink/grey only. All neutrals are tinted toward sage (chroma 0.005–0.01); no semantic red/green/blue, no gradients. Light theme by physical scene, not category.

### Primary
- **Pale Sage Canvas** (#d7dbd2 / oklch(90% 0.02 125)): page canvas, header, stat strip, expanded rows — the single background. Used everywhere; `--qb-canvas`. No lighter tints.

### Neutral
- **Near-Black Ink** (#0f1410 / oklch(15% 0.01 125)): primary text, active marks, strong status, square/circle fills, focus ring `--qb-ink`, `--qb-focus`, `--qb-system-marker`, `--qb-review-marker`.
- **Muted Slate** (#545a54 / oklch(50% 0.02 125)): secondary text, labels, dividers' text — `--qb-muted-ink`. Meets 4.5:1 on sage for 12–13px.
- **Line** (#b9bebb / oklch(78% 0.01 125)): 1px rules, borders, connectors — `--qb-line`. Low-contrast, never an accent.

### Named Rules
**The Sage-Only Rule.** The only background is Pale Sage Canvas. No `var(--qb-surface)` or `var(--qb-surface-deep)` lighter tints; they resolve to the same `#d7dbd2`. Depth is via `1px` rules and typographic hierarchy, not tonal steps.

## 3. Typography

**Display Font:** Inter, Aeonik, Helvetica Neue, system-ui, sans-serif (650, clamp 1.5–1.9rem, 1.15, -0.02em)
**Body Font:** Inter, Aeonik, Helvetica Neue, system-ui, sans-serif (400, 13px, 1.5, 65–75ch max)
**Label/Mono Font:** JetBrains Mono, SF Mono, ui-monospace, monospace (400, 12px; labels 650, 11px, 0.06em uppercase)

**Character:** Operational and restrained, not editorial. Hierarchy via scale + weight contrast ≥1.25 between steps; no flat scales. Mono for times, durations, repository-adjacent tokens.

### Hierarchy
- **Display** (650, clamp 1.5–1.9rem, 1.15, -0.02em): page `h1` (hidden on evaluations monitor, nav carries the wayfinding).
- **Headline** (700, 1.15rem, 1.2): section `h2` (Reviews, Repositories, Analytics, System).
- **Title** (650, 13px, 1.5): row repository names, `dt` labels.
- **Body** (400, 13px, 1.5, 65–75ch): descriptions, table body, prose — capped for readability.
- **Label** (650, 11px, 0.06em, uppercase): filter labels, table headers, stat labels, timeline status text.

### Named Rules
**The Mono-for-Time Rule.** Times, durations, and commit-adjacent values are always mono 12px; everything else is Inter.

## 4. Elevation

Completely monochrome and flat — no shadows, no elevation. Like an old LCD screen without the pixels is the whole vibe. Depth is conveyed via 1px `var(--qb-line)` rules, `qb-deep-surface` is the same sage but semantically marks hierarchy/expansion, and typographic weight. If a shadow appears, it is a bug.

**The Flat-By-Default Rule.** Surfaces are flat at rest. No `box-shadow` on stat strips, rows, panels, or headers; `shadow: none` globally.

## 5. Components

### Buttons
- **Shape:** 8px radius for normal buttons; 999px only where the monitor explicitly uses it (timeline nodes, avatar). Primary uses ink background, canvas text.
- **Primary:** `background: var(--qb-ink)`, `color: var(--qb-canvas)`, `padding: 6px 12px`, `font-weight: 650`.
- **Hover / Focus:** `hover` inverts to `var(--qb-muted-ink)` or `var(--qb-surface)`; `:focus-visible` is 2px solid `var(--qb-focus)` with 2px offset, never removed by `overflow: clip`.
- **Secondary / Ghost:** transparent or `var(--qb-canvas)` with `1px` line border, muted-ink text.

### Chips
Not used. Status is text + shape (square/circle + connector + `aria-live`), not pills. Do not introduce pill badges.

### Cards / Containers
- **Corner Style:** 8–10px where panels need it; many monitor surfaces are `border-radius: 0` with only `1px` rules (stat strip, ledger).
- **Background:** `var(--qb-canvas)` everywhere per Sage-Only Rule.
- **Shadow Strategy:** none — see Elevation.
- **Border:** `1px solid var(--qb-line)` for rules and dividers; `border:0` for stat cells where the outer strip provides the line.
- **Internal Padding:** `18px 24px` for stat cells; `10px 0` for ledger rows; `12px 58px 16px 82px` for expanded detail.

### Inputs / Fields
- **Style:** `min-height: 2.1rem`, `1px solid var(--qb-line)`, `8px` radius, `var(--qb-canvas)` or `var(--qb-surface)` (now same sage), `4px 8px` padding.
- **Focus:** same 2px `var(--qb-focus)` ring.
- **Error / Disabled:** `opacity: 0.45`, `cursor: not-allowed`, no red.

### Navigation
- **Style:** Horizontal `qb-header` `position: sticky`, `display:flex`, `gap:16px`, `padding:10px 20px`, `border-bottom: 1px solid var(--qb-line)`. Brand is 36px rounded-8 `QB` ink square (`aria-label="Quality Bar"`), title `Quality Bar` 15px 650. Left group `Evaluations/Reviews/Repositories`, right group `Analytics/System` via `qb-nav-group + qb-nav-group {margin-left:auto; padding-left:16px; border-left:1px solid var(--qb-line)}`. Links `13px 600`, `muted-ink` at rest, `ink` + `underline 1.5px offset 4px` when `aria-current="page"` (non-color indicator). Actions `☼` and future avatar in `qb-header-actions` `margin-left:auto`.

### Signature Component — Evaluation Ledger Row
- **Row:** `evaluation-row` grid `1fr 190px 22px`, `10px 0` padding, `border-top: 1px solid var(--qb-line)`, `qb-timeline` on right with `qb-timeline-connector` `1px` ink (85% opacity) and `qb-timeline-node--system` 10px square vs `--review` 10px circle, `aria-expanded`/`aria-controls` toggle with chevron (45°→225°).

## 6. Do's and Don'ts

### Do:
- **Do** use one sage canvas (`#d7dbd2`) for every background; depth only via `1px` rules and type weight.
- **Do** keep square system vs circular Review geometry plus visible status text; never rely on color or shape alone.
- **Do** keep `aria-current="page"` + underline (1.5px, offset 4px) for active nav; keep `:focus-visible` 2px ink ring.
- **Do** group ledger by local calendar day, newest first, `Today`/`Yesterday` labels, `created_at DESC, id DESC`, `em dash` for no data.
- **Do** cap body at 65–75ch and use mono for times/durations.

### Don't:
- **Don't** add a lighter `var(--qb-surface)` / `var(--qb-surface-deep)` tint — violates Sage-Only Rule.
- **Don't** use `border-left/right` >1px as a colored accent stripe (rewrite with full border or background tint).
- **Don't** use `background-clip: text` gradient text.
- **Don't** add glassmorphism blurs or hero-metric big numbers with small labels.
- **Don't** build identical card grids or use modals as first thought — use inline disclosure (`details`/`summary`, expanded `qb-deep-surface`).
- **Don't** introduce pill badges, sidebars, inbox/Needs attention queues, or generic `Jobs/Tasks` language.
- **Don't** use `#000`/`#fff` — tint every neutral toward sage.
- **Don't** animate layout properties; use `ease-out-quart/quint/expo` only.
