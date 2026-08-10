import assert from "node:assert/strict";
import { test } from "node:test";

import { operatorPage } from "../src/browser-pages.js";

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
  assert.match(operatorPage({ view: "analytics" }), /qb-deep-surface/);
  const system = operatorPage({ view: "system" });
  assert.match(system, /qb-deep-surface/);
  assert.ok(
    system.indexOf('id="codex-execution-title"') <
      system.indexOf('id="storage-reserve-title"'),
  );
});
