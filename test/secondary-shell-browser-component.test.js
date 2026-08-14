import assert from "node:assert/strict";
import { test } from "node:test";

import { operatorPage } from "../src/browser-pages.js";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.js";

test("shared shell carries one status/outcome glyph vocabulary", () => {
  // Single source of the clear/advisory/blocking/error shapes, aliased to
  // both the shared `.qb-outcome-icon` and the existing evaluation classes.
  assert.match(
    FONO_LCD_STYLE,
    /\.qb-outcome-icon,\.evaluation-status__icon\{display:inline-grid/,
  );
  assert.match(
    FONO_LCD_STYLE,
    /qb-outcome--clear.*evaluation-status--clear.*content:"✓"/,
  );
  assert.match(
    FONO_LCD_STYLE,
    /qb-outcome--advisory.*border:0;border-radius:0;background:transparent.*content:"△"/,
  );
  assert.match(
    FONO_LCD_STYLE,
    /qb-outcome--blocking.*border:1px solid.*background:linear-gradient\(45deg.*center\/9px 9px no-repeat.*content:none/,
  );
  assert.match(FONO_LCD_STYLE, /qb-outcome--error.*content:"!"/);
});

test("secondary views use the shared shell and compact detail hierarchy", () => {
  for (const view of [
    "evaluations",
    "reviews",
    "repositories",
    "analytics",
    "system",
  ]) {
    const page = operatorPage({ view });
    assert.match(page, /class="qb-app-shell"/);
    assert.match(page, /class="qb-primary-nav"/);
    assert.match(
      page,
      new RegExp(`aria-current="page" href="/\\?view=${view}"`),
    );
    assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
    assert.doesNotMatch(page, /<aside\b/);
  }
  assert.match(operatorPage({ view: "review-detail" }), /qb-deep-surface/);
  const repositoryDetail = operatorPage({ view: "repository-detail" });
  assert.match(repositoryDetail, /qb-deep-surface/);
  assert.equal((repositoryDetail.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(repositoryDetail, /<aside\b/);
  assert.match(
    repositoryDetail,
    /aria-current="page" href="\/\?view=repositories"/,
  );
  assert.match(operatorPage({ view: "repositories" }), /qb-deep-surface/);
  const system = operatorPage({ view: "system" });
  assert.match(system, /qb-deep-surface/);
  assert.ok(
    system.indexOf('id="codex-execution-title"') <
      system.indexOf('id="storage-reserve-title"'),
  );
});
