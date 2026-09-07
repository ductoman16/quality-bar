# Product

## Register
product

## Users
One authenticated owner/operator monitoring roughly 5–25 repositories and hundreds of Evaluations. Context: an internal tool used in current Firefox on macOS and Windows desktop and on Android tablet and phone, often glanced at to confirm the system is working rather than triage an inbox. Job to be done: watch current and recent runs, drill into a single Evaluation for trustworthy, inspectable results — not authoring prose or taking remediation inside Quality Bar.

## Product Purpose
Quality Bar is an AI code-review management and execution platform that feels like a calm, exact, fast operational CI system. Success on the Evaluations monitor is at-a-glance scannability: the ledger of recent runs is the first thing seen, system execution is visibly labeled apart from configured Reviews, active work is understandable without invented progress, and detail is rich enough for inspection without turning the list into a report.

## Brand Personality
Calm, exact, operational. Pale sage canvas, near-black ink, layered greys for structure; compact rows, 1px rules, restrained borders, shallow shadows. No instructional paragraphs, no generic Jobs/Tasks language — only Evaluation, Review, Repository, Analytics, System.

## Anti-references
All of the above: generic SaaS / inbox dashboards with Needs attention queues, pill badges, sidebars, persistent attention panels; neon / glassmorphism / gradients / gradient text; marketing heroes with big-number hero metrics. In this product, color is supplemental (status has text/shape/pattern), geometry is not the only meaning, and connected timelines use fill/outline + labels.

## Design Principles
1. **Operational calm over inbox urgency** — one chronological ledger grouped by local day, not Active/Recent/Attention buckets.
2. **System vs configured is visible** — every timeline label identifies a system phase or configured Review, in stable order `reviews.id ASC, review_runs.id ASC`; Fono status shapes communicate lifecycle rather than domain kind.
3. **No fabrication** — use only existing API/domain semantics for status, timing, findings; derive coarse phases from `applicability_sealed_at` and `review_runs` facts; never invent sub-step timings or progress.
4. **Truthful metrics, honest empty states** — Pass Rate/P95 are windowed fleet facts with explicit `No data` (em dash) when denominator/sample is zero; Updated is last successful refresh; Workers/Queue are live from `/system`.
5. **Keyboard-first and resilient** — every control reachable with visible `:focus-visible` (near-black ring), `aria-current` + non-color active indicator, `prefers-reduced-motion` respected; errors never render as empty lists or fabricated zeros.

## Accessibility & Inclusion
Keyboard-first. All navigation, filters, disclosures, forms, actions, dialogs, and status surfaces remain keyboard reachable with visible focus; geometry/color never stands alone. Respect `prefers-reduced-motion`; no animation is required for comprehension. Desktop, tablet, and phone are intentional Firefox surfaces; constrained navigation uses Fono's drawer and semantic tables remain tables inside horizontal overflow frames.
