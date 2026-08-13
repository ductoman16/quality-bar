# UI Usability Audit

A task-centric audit of the operator UI. The premise: the app was built page-by-page by
surfacing every available field and control, not designed around what an operator is trying
to *do*. This audit re-anchors each surface on a job, measured against the one page that
already works — Evaluations.

Status: **Full audit complete.** Yardstick signed off; all four pages scored; prioritized backlog
below. Next: implement top fixes after backlog sign-off.

---

## Charter

**Who it's for.** A small shared technical team on one instance. Domain fluency assumed
(PRs, evaluations, reviews, waivers). Schema/DB vocabulary leaking into a label is a finding.
Multi-user concerns (attribution, whose config) are in scope — but note the app currently has
**no per-user identity** (one shared operator login), so "who did what" is a *product gap* to
flag, not a rearrange.

**The three jobs.** Every page is judged by which job it serves:

| Job | Question the operator is asking | Pages |
|-----|--------------------------------|-------|
| **Monitor** | "Are evaluations running? Is anything wrong?" | Evaluations *(yardstick)*, System |
| **Configure** | "Set up / adjust reviews and repositories." | Reviews, Repositories |
| **Improve** | "How do we make reviews more effective / cost-efficient?" | Analytics *(decision-support)* |

**Value axes.** Every element is judged on four axes, not usability alone:
- **Usability** — can the operator do the job quickly and without confusion?
- **Consistency** — same concept, same vocabulary and iconography, *everywhere it appears*
  (row, expansion, timeline, detail page).
- **Correctness** — does the UI say the true, specific thing? ("Completed" where the real
  answer is "Clear/Advisory/Blocking" is a correctness bug — information thrown away.)
- **Minimalism** — no redundant markers, no element that doesn't earn its place.

**Rules of engagement.**
- LCD design language is the default. A finding *may* recommend breaking it, but only with a
  concrete usability justification, not taste. High bar.
- Full authority to cut — including "this whole section shouldn't be in the UI." Each cut is
  tagged **[move]** (goes elsewhere) or **[remove]** (capability becomes API-only/unreachable)
  so the second kind can be vetoed explicitly.
- Full depth: page-level IA **and** embedded flows (connection setup, waiver adjudication,
  criteria/metadata editors, System admin plumbing).

**Method, per page.**
1. **Job statement** — "someone comes here to ___." If it can't be written cleanly, that's finding #1.
2. **Bucket every element** — Essential / Demote / Cut / Missing, against that job.
3. **Score on the rubric** (below).
4. **Prioritized backlog** — payoff vs. effort, each item tied to a finding.

**Process.** Reviews first as the calibration page → sign-off → Repositories, Analytics, System.
End state: after sign-off, implement top fixes page-by-page with review.

---

## Phase 0 — The Evaluations Yardstick

*Why Evaluations works, reverse-engineered from
[`src/evaluation-monitor-page.js`](src/evaluation-monitor-page.js) and the rendered page. This
is the written standard the rest of the app is measured against. **Approve or adjust before
scoring begins.***

The page answers one question — *"what is the evaluation fleet doing right now, and did
anything go wrong?"* — and everything on it serves that question. Seven properties make it work:

### 1. One answer above the fold, in fixed positions
A five-cell stat strip (Workers · Queue · P95 Duration · Clear Rate · Updated) sits at the top
and answers "is the fleet healthy?" before the eye moves. The values are the loud element;
labels are muted and small. You can read fleet health in under two seconds without scrolling.
→ *Test for other pages: is there a single glanceable answer at the top, or does the operator
have to assemble it from scattered parts?*

### 2. One dominant object, one row each
The body is a **ledger** of evaluations — one object type, one row per instance, no competing
entities. Rows are scannable because every row shares the same column grid (time · repo ·
source · outcome · duration · progress). The eye tracks straight down any column.
→ *Test: does the page have one clear primary object, or several fighting for the same space?*

### 3. Progressive disclosure in three levels
Nothing is dumped. **Row** = the outcome. **Expand (caret)** = per-step status table.
**Detail page (→)** = full findings. Each level answers one question deeper, and you only pay
for the depth you open.
→ *Test: is detail on-demand and layered, or is everything visible at once?*

### 4. Exactly one primary action, the rest deferred
"+ New evaluation" is the only emphasized control (filled button). Filters are collapsed behind
a summary. The create form is hidden until requested. The page defaults to *just the answer*;
controls appear when asked for.
→ *Test: is there one obvious primary action, or a wall of equal-weight buttons?*

### 5. Status is shown, not spelled out
At the **row** level, outcomes use a consistent monochrome glyph vocabulary (clear ✓, blocking !,
advisory △, pending/running dashed) plus a per-row timeline sparkline. State is legible at a
glance without reading words.
→ *Test: is state encoded consistently and glanceably, or carried only in prose/color-coded text?*

> ⚠️ **The yardstick is not exempt — and fails its own test in the row expansion.** The
> expanded per-step table breaks this principle three ways (see finding **E‑1**): it uses a
> *different* status glyph than the row, it says "Completed" (execution status) where the row
> would say "Clear/Advisory/Blocking" (outcome), and it shows a redundant kind-marker beside the
> step number. The row and the timeline get this right; the expansion regressed. This is the bar:
> the *same* concept must carry the *same* vocabulary and iconography everywhere it appears.

### 6. Grouped by the operator's mental model
Rows are grouped under date headings ("Today"), because the operator thinks in "what happened
recently," not in a flat unbounded list. The grouping matches how the job is actually thought about.
→ *Test: is the primary list ordered/grouped the way the operator reasons, or by DB insertion order?*

### 7. Machine data reads as machine data
Times, durations, commit SHAs, and counts are monospace; human labels are proportional. The
distinction is instant and never decorative — every visual difference carries meaning.
→ *Test: does typographic treatment carry meaning, or is weight/mono applied arbitrarily?*

### The rubric (derived from the above)
Each page is scored 0–3 on:
1. **2-second answer** — is the page's primary question answered at the top, glanceably?
2. **Weight matches importance** — do the loudest elements correspond to what matters most?
3. **Nothing un-actionable here** — is everything shown something the operator needs *on this page, now*?
4. **Layered disclosure** — is detail on-demand rather than all-at-once?
5. **Operator language** — do labels speak the job, not the schema?
6. **Consistent state vocabulary** — is status encoded the same way everywhere it appears?
7. **Designed empty/loading/error states** — are the non-happy paths deliberate, not defaults?

---

## Findings — Evaluations (the yardstick is not exempt)

### E‑1 — Row expansion abandons the outcome vocabulary · axes: consistency, correctness, minimalism
**Where:** [`src/browser/evaluation.js:438`](src/browser/evaluation.js:438) (`expandedStep`),
status maps at [`evaluation.js:320`](src/browser/evaluation.js:320).
**What:** The expanded per-step table renders status via `nodeStatus(status)`, which maps
*execution* status (`completed → "Completed"`). It never reads `node.outcome`. The timeline
sparkline beside it ([`evaluation.js:368`](src/browser/evaluation.js:368)) already prefers
`node.outcome` and shows "Clear/Advisory/Blocking" — so the data is present and the two
renderings of the same node disagree.
**Three defects in one:**
1. *Correctness* — a completed review step says "Completed" instead of its actual outcome
   (Clear/Advisory/Blocking). Real information is discarded.
2. *Consistency* — the expansion's status glyph (`evaluation-node-status__icon`, filled/hollow
   circle on complete/failed) differs from the row's `✓ ! △` outcome glyphs and from the
   timeline nodes.
3. *Minimalism* — a `evaluation-step__marker--{kind}` glyph sits beside the step number **and**
   a status glyph sits in the Status column; the kind is already legible from the timeline.
**Fix direction:** For **review** steps, drive both the glyph and the label from `node.outcome`
using the *same* vocabulary component the row uses (Clear ✓ / Advisory △ / Blocking ! / Error !).
**System** steps (Preparing/Finalizing) have no outcome — show execution status only, and drop
the redundant kind-marker so the Status column is the single source of state. One state
vocabulary, rendered once per row.
**Tag:** row-level defect; fix is a **[move]** of existing data into the correct vocabulary
(no capability lost). Low effort, high consistency payoff. Candidate quick win.

---

## Phase 1+ — Page audits

### Reviews (Configure) — scored against the rubric

**Job statement.** *"Someone comes here to set up and tune the reviews that run against PRs —
what each review checks (criteria), how strict (blocking vs advisory), which repos it applies
to, and which model runs it."* Writes cleanly → the page has a real job. Two levels:
the **catalog** (which review?) and the **editor** (change this review).

**Sources.** [`src/review-page.js`](src/review-page.js);
catalog [`src/browser/review-catalog.js`](src/browser/review-catalog.js);
editor bundles (metadata/version/assignment/archival/delete).

**What works (inherits the yardstick).** The catalog is a proper ledger — one review per row,
shared columns (mark · name · scope · criteria split · version · model · open), expand →
read-only criteria preview → detail page. Layered disclosure is correct (rubric #4 = 3/3).
Loading/empty/error states exist.

#### Findings

**R‑1 — Create and edit model the same review as two different shapes · usability, consistency**
Tag: **[move]** · medium effort · high payoff.
The **create** form ([`review-page.js:2`](src/review-page.js:2)) is one flat form: name,
description, criteria, model, reasoning, service tier → *Create Review*. The **edit** page
([`review-page.js:21`](src/review-page.js:21)) splits the *same* object into an "Active version"
group (criteria + applicability rule + codex) and a separate "Review" group (Identity /
Assignment / Lifecycle) with **three separate save buttons**. So a review looks like one simple
form when created and a three-form control panel when edited. The version/lineage domain split is
correct internally but is leaked raw into the UI. *Direction:* make the create form a subset of
the same shape the editor uses, so learning one teaches the other.

**R‑2 — Applicability rule can't be set at creation · correctness, consistency**
Tag: **[move]** · low effort.
The edit form has an **Applicability rule** field; the create form has none
([`review-page.js:2`](src/review-page.js:2) vs [`:14`](src/review-page.js:14)). A review can't be
fully configured in one pass — you create, then re-open to set applicability. Either surface it at
creation or make clear it's intentionally deferred.

**R‑3 — Three "Save" scopes on one page, no explanation · usability**
Tag: keep, clarify · low effort.
*Save Review Version*, *Save metadata*, *Save Assignment* (+ *Reactivate*, *Delete*) — three save
verbs, five mutation controls. The operator must already understand that criteria edits mint a new
immutable **version** while identity/assignment mutate the **lineage** in place. Nothing on the
page teaches that "Save Review Version" means "create v2." *Direction:* one line of the version
consequence at the save point, or unify save affordances with scoped labels.

**R‑4 — Meta readout duplicates the editors directly below it · minimalism**
Tag: **[remove]** (of duplication) · low effort.
The header `<dl>` restates Assignment, Codex, and Criteria — the exact fields being edited a few
rows down. On a pure inspect page that readout earns its place; on a page that is *also* the editor
it's redundant. *Direction:* keep only what the editors don't already show (e.g. active-version
number, lifecycle state); drop the rest.

**R‑5 — blocking/advisory glyphs disagree with Evaluations · consistency** *(cross-page, E‑1 class)*
Tag: **[move]** to shared vocabulary · low effort · high payoff.
Reviews draws criterion impact as filled circle = blocking, hollow circle = advisory
([`review-page.js:33`](src/review-page.js:33)). Evaluations draws the *same-named* outcomes as
filled-circle-`!` = blocking and triangle `△` = advisory. Same concept, two glyph systems.
*Direction:* one shared impact/outcome glyph component used by both pages.

**R‑6 — Redundant page `<h1>` the yardstick removed · consistency, minimalism** *(cross-page)*
Tag: **[remove]** · trivial.
The Reviews **list** shows a large "Reviews" heading; Evaluations deliberately suppresses its shell
`<h1>` because the active nav item already names the page. Every non-Evaluations page keeps this
redundant heading (verified: only the evaluation/review-detail views hide `.qb-page-heading`).
*Direction:* suppress the shell heading app-wide for consistency with the yardstick.

**R‑7 — Archived reviews are unreachable · usability (Missing)**
Tag: capability gap · medium effort.
The catalog shows active reviews only; archived reviews aren't listed and the archival/restore
control is hidden in the editor, so a review, once archived, can't be found or restored from the UI
(the API supports `?state=archived`). *Direction:* surface archived in the catalog with a filter.

**R‑8 — Catalog doesn't refresh after in-place edits · correctness (feedback)**
Tag: bug · low effort.
The catalog refreshes on `quality-bar:review-created` but not after metadata/assignment/version
edits, so a saved change isn't reflected until reload — the operator can't trust what they see.

**R‑9 — The primary "create review" action is hidden · usability (discoverability), consistency**
Tag: **[move]** to a top-of-page primary action · low effort · **high payoff**.
"Create a review" is the page's core job, yet it lives as a muted, collapsed
`+ NEW REVIEW` `<details>` summary at the **bottom** of the catalog
([`review-page.js:17`](src/review-page.js:17), styled like a filter label at
[`:35`](src/review-page.js:35)) — easy to miss entirely. Evaluations does the opposite: its
"+ New evaluation" is a **filled button in the top controls row**, the single emphasized action
(yardstick #4). *Direction:* promote "New review" to an emphasized action at the top of the page,
matching the Evaluations pattern. Cross-page: primary create-action placement should be consistent
app-wide.

#### Score (0–3; Configure weighting — task clarity over 2-second answer)
| # | Rubric dimension | Score | Note |
|---|---|---|---|
| 1 | Primary answer obvious | 2 | Catalog "which review" is clear; editor entry less so |
| 2 | Weight matches importance | 2 | Meta readout competes with editors (R‑4) |
| 3 | Nothing un-actionable here | 2 | Duplicated readout (R‑4) |
| 4 | Layered disclosure | 3 | Catalog→expand→detail, inherits yardstick |
| 5 | Operator language | 2 | version/lineage split leaks (R‑1, R‑3) |
| 6 | Consistent state vocabulary | 2 | internally OK, cross-page glyph drift (R‑5) |
| 7 | Designed empty/error states | 2 | present; archived path missing (R‑7) |

Reviews is structurally close to the yardstick, with two gaps. **Discoverability:** the page's
core action — create a review — is hidden at the bottom as a muted disclosure (R‑9), the single
highest-payoff fix. **The editor:** it leaks the version/lineage model (R‑1/R‑3), duplicates
itself (R‑4), and drifts from the shared status vocabulary (R‑5). The catalog itself is
yardstick-grade.

---

### Repositories (Configure) — scored against the rubric

**Job statement.** *"Someone comes here to connect the repos quality-bar watches and manage
their state — add a repo (via HTTPS, GitHub, or Forgejo), see each repo's health and which
reviews apply, and enable/disable/retire or rotate credentials."* Writes cleanly.

**Sources.** [`src/repository-page.js`](src/repository-page.js);
inventory [`src/browser/repository.js`](src/browser/repository.js);
connection bundles (github/forgejo).

**What works.** The Overview stat strip (Repositories · Enabled · Disabled · Retired · Health
errors) is glanceable and yardstick-grade (rubric #1 = 3/3). The inventory is a proper expandable
ledger reusing the Evaluations/Reviews pattern.

#### Findings

**Rep‑1 — Three always-open "add a repository" surfaces stacked below the inventory · usability, minimalism**
Tag: **[move]** behind one disclosed action · medium effort · **high payoff**. *The headline finding.*
Below the inventory the page permanently shows three separate registration surfaces — **Register
HTTPS repository** (3-field form), **GitHub Connection** (Connect GitHub App), **Forgejo
Connection** (3-field form) — all expanded, all competing, consuming most of the page. They are
three providers for **one job: "add repositories."** This is the "everything the AI put on the
page" pattern in its purest form. *Direction:* one primary "Add repository" action that discloses a
provider choice (HTTPS / GitHub / Forgejo), matching the single-primary-action discipline of the
yardstick. Collapses three permanent forms into one deliberate flow.

**Rep‑2 — Generic repos show the raw `.git` URL where forge repos show a clean name · consistency**
Tag: **[move]** · low effort.
`primaryName` ([`repository.js:279`](src/browser/repository.js:279)) uses the clean
`repository.name` for GitHub/Forgejo repos but the full `https://…/x.git` URL for generic HTTPS
repos, so the inventory mixes clean names and noisy URLs in the same column. Evaluations always
shows a clean repo name. *Direction:* derive a clean display name (`owner/repo`) for HTTPS repos too;
keep the full URL for the expanded facts / detail page.

**Rep‑3 — "Unavailable" shown for data that exists · correctness**
Tag: bug · low effort.
Assignments and Latest verification are hardcoded to `"Unavailable"` for any non-forge repo
([`repository.js:224`](src/browser/repository.js:224)) — the code only reads `assignment_count` /
`verified_at` for forge connections. A plain HTTPS repo that *is* verified and *has* review
assignments still displays "Unavailable" in both columns. Beyond the bug, "Unavailable" is the wrong
word for "none/not-yet" even when correct. *Direction:* read the fields for all providers; use a
real value or a meaningful empty state (`0`, `None`, `—`, `Unverified`), never "Unavailable".

**Rep‑4 — Register form is always expanded, occupying prime space for an occasional action · usability, minimalism**
Tag: **[move]** · folds into Rep‑1.
Adding a repo is occasional; the HTTPS register form is permanently open. Contrast the Evaluations
create form (hidden behind the primary action). *Direction:* disclosed, not always-on (subsumed by Rep‑1).

**Rep‑5 — Every page invents its own "create" pattern · consistency** *(cross-page, R‑9 class)*
Tag: consistency · design decision.
Primary-object creation now has three different treatments: Evaluations = filled button, top;
Reviews = muted disclosure, bottom (R‑9); Repositories = three always-open forms, bottom (Rep‑1).
Pick one pattern (recommend Evaluations') and apply it everywhere.

**Rep‑6 — Redundant page `<h1>` · consistency, minimalism** *(cross-page, R‑6)*
Same as R‑6 — "Repositories" heading duplicates the active nav item the yardstick suppresses.

#### Score (0–3; Configure weighting)
| # | Rubric dimension | Score | Note |
|---|---|---|---|
| 1 | Primary answer obvious | 3 | Overview strip + inventory, yardstick-grade |
| 2 | Weight matches importance | 1 | Three always-open add-forms dominate the page (Rep‑1) |
| 3 | Nothing un-actionable here | 1 | Three registration surfaces at once; "Unavailable" noise |
| 4 | Layered disclosure | 2 | Inventory layers well; registration doesn't (Rep‑1/‑4) |
| 5 | Operator language | 2 | raw URLs (Rep‑2), "Unavailable" (Rep‑3) |
| 6 | Consistent state vocabulary | 2 | overview glyphs OK; create pattern drift (Rep‑5) |
| 7 | Designed empty/error states | 1 | "Unavailable" is a non-designed empty state (Rep‑3) |

The **inventory is yardstick-grade**; the page is dragged down by the **registration zone** —
three permanent provider forms where there should be one disclosed action (Rep‑1), plus data
-correctness gaps in the ledger (Rep‑2/‑3).

### Analytics (Improve) — scored against the Improve rubric

**Job statement.** *"Someone comes here to learn how to make reviews better — are they catching
the right things, which reviews/criteria are noisy or low-value, and what do they cost — so they
can tune them."* The job is inherently **comparative and over-time**; a snapshot can't answer it.

**Sources.** [`src/analytics-page.js`](src/analytics-page.js),
[`src/browser/analytics.js`](src/browser/analytics.js).

**Improve-rubric reframing.** For a decision-support page the rubric bends: #1 "primary answer" =
*does the page answer the improvement question?*; #3 "nothing un-actionable" = *does every metric
map to a decision the operator makes?*

**What works.** Visually LCD-clean (the recent redesign landed the *look*). The Overview strip is
glanceable. But the redesign fixed the surface, not the information architecture.

#### Findings

**A‑1 — The page is a metric dump, not decision-support · usability** *(the core Improve failure)*
Tag: **restructure** · high effort · **highest payoff on this page**.
~13 metric tables (Evaluation outcomes, Finding impact, Criterion transitions, Review
applicability, Criterion outcomes, Waiver coverage, Decision history, Review-run reliability,
Waiver-adjudication reliability, Failure codes, Execution duration, Token counters) render every
metric the system can compute, none organized around a decision. This is "everything the AI put on
the page," in metric form. *Direction:* invert it — start from the 3–4 decisions the operator makes
("is quality improving?", "which reviews/criteria are low-value or noisy?", "what's our cost trend
and cost per outcome?") and show only the metrics that drive them; demote the rest behind disclosure.

**A‑2 — No trend / time dimension · usability, correctness (Missing)**
Tag: capability gap · high effort · **high payoff**.
The Improve job is explicitly about **trends**, yet every figure is a single point-in-time
aggregate over one window. There is no time series, no period-over-period comparison, no "is
clear-rate rising or falling." A page for *improvement* with no time axis structurally cannot
answer its own question. *Direction:* make time the primary axis — trend lines / period compares
for the headline metrics.

**A‑3 — Cost efficiency is not first-class · usability (Missing)**
Tag: capability gap · medium effort · **high payoff**.
Half the stated job is cost efficiency, but the Overview strip is all effectiveness (clear /
blocking / error / review-run success) with **zero cost metric**. Cost data lives at the very
bottom in "Token counters," shown as "Unavailable," with no derived cost, no cost-per-evaluation,
no cost-per-outcome. *Direction:* promote a cost/efficiency metric to the headline (cost per
evaluation, cost per blocking finding caught) and trend it.

**A‑4 — Raw "Matching facts" fact tables don't belong on Analytics · minimalism, usability**
Tag: **[remove]** from Analytics · low effort.
The bottom two tables (EVALUATIONS, REVIEW RUNS) are raw record dumps — UUIDs, full 80-char
changeset strings, per-run config, "Unavailable / Unavailable / Unavailable" tokens. This is a DB
export, answers no aggregate question, and the per-record data already lives on the Evaluations
detail page. *Direction:* cut from Analytics entirely.

**A‑5 — Explanatory helper text violates the LCD "no instructive text" rule · consistency**
Tag: **[remove]** · trivial.
"Rates without a denominator are shown as —." and "Some token counters were not reported." are
exactly the instructive/helper sentences the design language bans. *Direction:* encode the meaning
in the glyph/format (e.g. "—" is self-evident) and delete the prose.

**A‑6 — Wide tables overflow horizontally · usability**
Tag: layout · medium effort.
Several tables run 9–17 columns (Review runs = 17) and scroll sideways, defeating scannability.
*Direction:* falls out of A‑1 — decision-first views need far fewer columns.

**A‑7 — Redundant `<h1>` (R‑6) and clear/blocking/error glyph drift (R‑5)** *(cross-page)*
The Overview strip re-encodes clear/blocking/error with its own glyphs, again diverging from the
Evaluations vocabulary; the "Analytics" heading duplicates the nav.

#### Score (0–3; Improve weighting — decision-support)
| # | Rubric dimension | Score | Note |
|---|---|---|---|
| 1 | Answers the improvement question | 1 | No trends (A‑2), no cost (A‑3); can't actually guide tuning |
| 2 | Weight matches importance | 1 | 13 tables equal-weight; cost & trend absent |
| 3 | Every metric maps to a decision | 0 | Metric dump + raw fact tables (A‑1, A‑4) |
| 4 | Layered disclosure | 1 | Almost everything shown at once |
| 5 | Operator language | 2 | mostly clear; "Unavailable" noise |
| 6 | Consistent state vocabulary | 2 | glyph drift (A‑7) |
| 7 | Designed empty/error states | 1 | "Unavailable" everywhere; helper-text patches (A‑5) |

Analytics is the **biggest gap between look and job**: the redesign made it calm and on-brand, but
it still answers "here is every number" instead of "here is how to improve." It needs the most
structural work (A‑1/A‑2/A‑3) and offers the highest payoff against your stated goal.

### System (Monitor) — scored against the rubric

**Job statement.** *"Someone comes here to answer 'is anything wrong?' — and, occasionally, to do
low-level admin (tokens, sessions, models, polling/delivery)."* Two jobs sharing one page: a
glanceable **health monitor** and an **admin console**. The audit's charter puts health first.

**Sources.** [`src/system-page.js`](src/system-page.js), [`src/browser/operator.js`](src/browser/operator.js),
system-* / storage / polling / delivery bundles.

**What works.** The top Health strip is the right instinct for the Monitor job — six named facts in
one row.

#### Findings

**Sys‑1 — Health can't be read at a glance: problem states don't pop · usability** *(the Monitor test)*
Tag: **candidate LCD override** · medium effort · **high payoff**.
Every health cell renders as a similar dark dot whether the state is good (Available/Ready/Complete)
or not (Backups: "Unavailable"). The one job of a monitor — making a problem jump out — fails
because "wrong" looks like "fine." This is the strongest candidate for a justified LCD override
(a distinct treatment for problem states); if kept monochrome, problem states need a different
glyph/weight, not the same dot. *Direction:* a single "all clear / N needs attention" summary at the
very top, with problem cells visually distinct.

**Sys‑2 — Health facts are shown twice · minimalism, consistency**
Tag: **[remove]** duplication · low effort.
Bootstrap, Durable core, Storage, Backups, and Migration each appear in **both** the top Health
strip **and** the lower "System status" list (at more detail). Same facts, two places, no stated
relationship. *Direction:* strip = the glanceable answer; everything below = on-demand detail for a
cell, not a second flat copy.

**Sys‑3 — Health monitoring and deep admin are undifferentiated on one page · usability**
Tag: **[move]** admin to its own surface · high effort · high payoff.
Under "System status" the page flat-lists, at equal weight, things that are *not* health: Codex
models, Browser sessions, Implementer token, Storage reserve, Polling, Delivery, Waiver Adjudicator
Configuration, and Operator onboarding tokens. An operator glancing "is anything wrong?" must wade
through model lists and token admin. *Direction:* separate "Health" (the monitor answer) from
"Administration" (tokens/sessions/models/config) — the latter disclosed or on its own route.

**Sys‑4 — Raw internal codes leak to the operator · correctness, consistency (schema leak)**
Tag: language · low effort.
Strings like `unavailable — application_version_unavailable: Application version is unavailable`
and `Migration not_required — 53 to 53` expose internal codes and stutter ("unavailable — …is
unavailable"). The charter treats schema/code vocabulary in labels as a finding. *Direction:* map
codes to operator language; show one clean phrasing, not code + restated prose.
*(Data caveat: some "unavailable" values here — Application version, Schema, Last backup — are dev-harness
artifacts; the finding is the leak format and duplication, which hold regardless of data.)*

**Sys‑5 — "Unavailable" as the universal non-value · correctness** *(cross-page — see X‑1)*
Backups/Application/Schema/Last-backup all read "Unavailable"; same word appears on Repositories
and Analytics. Now an app-wide cross-cutting item (X‑1).

**Sys‑6 — Redundant `<h1>` (R‑6)** *(cross-page)* — "System" duplicates the active nav item.

#### Score (0–3; Monitor weighting — 2-second answer matters most)
| # | Rubric dimension | Score | Note |
|---|---|---|---|
| 1 | 2-second "anything wrong?" answer | 1 | Problem states don't pop (Sys‑1) |
| 2 | Weight matches importance | 1 | Admin plumbing at same weight as health (Sys‑3) |
| 3 | Nothing un-actionable here | 1 | Duplication (Sys‑2) + admin mixed in (Sys‑3) |
| 4 | Layered disclosure | 1 | Everything flat under "System status" |
| 5 | Operator language | 1 | Raw code leaks (Sys‑4) |
| 6 | Consistent state vocabulary | 2 | strip glyphs OK but don't distinguish good/bad (Sys‑1) |
| 7 | Designed empty/error states | 2 | "Nothing queued." etc. fine; "Unavailable"/code leaks not |

System has the right **top strip** but buries the monitor answer under a duplicated,
admin-heavy flat list. Biggest wins: make problems pop (Sys‑1), de-duplicate (Sys‑2), and split
health from admin (Sys‑3).

---

## Cross-cutting findings (app-wide)

These recur on 2+ pages; fix once, centrally.

- **X‑1 — "Unavailable" is the universal non-value word.** Appears for missing/none/not-yet across
  Repositories (Rep‑3), Analytics (token/duration), and System (Sys‑5). Replace with meaningful,
  context-specific empty states (`0`, `None`, `—`, `Unverified`) — never a blanket "Unavailable".
- **X‑2 — No shared status/outcome glyph vocabulary.** clear/advisory/blocking/error are drawn
  differently on Evaluations (row `✓ ! △` vs its own expansion, E‑1), Reviews (filled/hollow
  circle, R‑5), and Analytics (A‑7). Build one glyph component; use it everywhere the concept
  appears.
- **X‑3 — Redundant page `<h1>`.** Every page except Evaluations repeats the active nav item as a
  heading (R‑6, Rep‑6, A‑7, Sys‑6). Suppress the shell heading app-wide.
- **X‑4 — Each page invents its own "create primary object" pattern.** Filled top button
  (Evaluations) vs muted bottom disclosure (Reviews, R‑9) vs three always-open forms (Repositories,
  Rep‑1). Standardize on the Evaluations pattern.
- **X‑5 — Instructive/helper prose the design language bans** appears on Analytics (A‑5) and, mildly,
  System. Encode meaning in format; delete the sentences.

---

## Prioritized backlog

Ranked by payoff ÷ effort. Each item links to findings. Tags: **[move]** rearrange, **[remove]**
delete, **[fix]** bug/correctness, **[build]** new capability.

### Tier 1 — Quick wins (high payoff, low effort)
| # | Change | Findings | Tag |
|---|---|---|---|
| 1 | Route the Evaluations row-expansion status through `node.outcome` using the row's glyph vocab; drop redundant kind-marker | E‑1 | fix |
| 2 | Suppress the redundant shell `<h1>` app-wide | X‑3 (R‑6/Rep‑6/A‑7/Sys‑6) | remove |
| 3 | Replace "Unavailable" with context-specific empty states everywhere | X‑1 (Rep‑3/Sys‑5) | fix |
| 4 | Cut the raw "Matching facts" tables from Analytics | A‑4 | remove |
| 5 | Delete banned helper/instructive prose | X‑5 (A‑5) | remove |
| 6 | De-duplicate System health facts (strip vs "System status") | Sys‑2 | remove |
| 7 | Drop the Reviews editor meta readout that duplicates the editors | R‑4 | remove |
| 8 | Refresh the Reviews catalog after in-place edits | R‑8 | fix |
| 9 | Show clean repo names (not raw `.git` URLs) in the inventory | Rep‑2 | move |
| 10 | Map System raw codes to operator language | Sys‑4 | fix |

### Tier 2 — Structural (high payoff, medium effort)
| # | Change | Findings | Tag |
|---|---|---|---|
| 11 | Build one shared status/outcome glyph component; adopt on all pages | X‑2 (E‑1/R‑5/A‑7) | move |
| 12 | Standardize + promote the "create primary object" action to a top primary action app-wide | X‑4 (R‑9/Rep‑1) | move |
| 13 | Consolidate the three Repositories registration surfaces into one disclosed "Add repository" flow | Rep‑1/Rep‑4 | move |
| 14 | Make System problem states visually pop (candidate LCD override) + "N need attention" summary | Sys‑1 | move |
| 15 | Split System into Health vs Administration | Sys‑3 | move |
| 16 | Unify the Reviews create form and edit page to one shape; add applicability at creation | R‑1/R‑2 | move |
| 17 | Surface archived reviews (catalog filter + reachable restore) | R‑7 | build |
| 18 | Clarify the version consequence of "Save Review Version" | R‑3 | move |

### Tier 3 — Big bets (high payoff, high effort) — the Analytics rebuild
| # | Change | Findings | Tag |
|---|---|---|---|
| 19 | Restructure Analytics around 3–4 operator decisions; demote the metric dump | A‑1/A‑6 | move |
| 20 | Add a time/trend axis to the headline metrics | A‑2 | build |
| 21 | Make cost efficiency first-class (headline cost metric, cost per outcome, trended) | A‑3 | build |

**Suggested order:** all of Tier 1 first (fast, visible, and #1–#3 double as calibration that the
shared-vocabulary direction is right), then Tier 2 #11–#12 (they unlock consistency everywhere),
then decide whether the Analytics rebuild (Tier 3) is a project of its own.
