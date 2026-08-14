import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  browserElement,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

/** Read a `data-*` attribute the mock stores via `setAttribute` (Reflect.set).
 * @param {unknown} element */
const dataState = (element) =>
  /** @type {Record<string, unknown>} */ (element)["data-state"];

const repositoryRoot = resolve(import.meta.dirname, "..");

const HEALTH_IDS = [
  "codex",
  "durable",
  "storage",
  "backups",
  "migration",
  "bootstrap",
];

class FakeCustomEvent {
  /** @param {string} type @param {{detail?: unknown}} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
}

/**
 * Boot operator.js against a mocked /api/v1/system payload and return the
 * summary and per-tile elements after the health strip has rendered.
 * @param {object} system
 */
async function renderHealth(system) {
  const summary = browserElement();
  const summaryText = browserElement();
  /** @type {[string, ReturnType<typeof browserElement>][]} */
  const overrides = [
    ["system-health", browserElement()],
    ["system-health-summary", summary],
    ["system-health-summary-text", summaryText],
  ];
  /** @type {Record<string, ReturnType<typeof browserElement>>} */
  const tiles = {};
  /** @type {Record<string, ReturnType<typeof browserElement>>} */
  const values = {};
  for (const id of HEALTH_IDS) {
    tiles[id] = browserElement();
    values[id] = browserElement();
    overrides.push([`system-health-${id}`, tiles[id]]);
    overrides.push([`system-health-${id}-value`, values[id]]);
  }
  const elements = repositoryBrowserElements(overrides);
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    readBrowserAsset("/assets/operator.js"),
    {
      CustomEvent: FakeCustomEvent,
      Date,
      document: {
        cookie: "quality_bar_configured_csrf=csrf-token",
        addEventListener() {},
        dispatchEvent() {},
        createElement() {
          return browserElement();
        },
        /** @param {string} id */
        getElementById(id) {
          return elements.get(id) ?? null;
        },
      },
      /** @param {string} path */
      async fetch(path) {
        if (path !== "/api/v1/system") {
          throw new Error(`system_health_unexpected_fetch: ${path}`);
        }
        return {
          ok: true,
          async json() {
            return system;
          },
        };
      },
      window: {},
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  return { summary, summaryText, tiles, values };
}

const HEALTHY_SYSTEM = {
  backup: { status: "current" },
  bootstrap: { status: "complete" },
  browser_sessions: { active_count: 0 },
  codex: { catalog: { models: [] }, status: "available" },
  durable_core: { status: "ready" },
  execution_providers: [{ id: "codex", name: "Codex", status: "available" }],
  implementer_token: { status: "revoked" },
  migration: { status: "completed" },
  storage: { status: "available" },
};

test("the System page leads with an all-clear summary and the problem glyph in its styles", () => {
  const page = operatorPage({ view: "system" });
  assert.match(page, /id="system-health-summary"/);
  assert.match(page, /id="system-health-summary-text">All clear<\/p>/);
  // The summary sits above the health strip so a bad system announces itself.
  assert.ok(
    page.indexOf('id="system-health-summary"') <
      page.indexOf('id="system-health"'),
  );
  // Problem tiles drop the shared dot for a bold "!" mark, not another dot.
  assert.match(
    page,
    /\.sys-health__tile\[data-state="warn"\] \.sys-health__value::before\{content:"!"/,
  );
  assert.match(
    page,
    /\.sys-summary\[data-state="warn"\] \.sys-summary__line::before\{content:"!"/,
  );
});

test("a fully healthy system reads All clear with every tile ok", async () => {
  const { summary, summaryText, tiles } = await renderHealth(HEALTHY_SYSTEM);
  assert.equal(summaryText.textContent, "All clear");
  assert.equal(dataState(summary), "ok");
  for (const id of HEALTH_IDS) {
    assert.equal(dataState(tiles[id]), "ok");
  }
});

test("a single problem reads 1 needs attention and marks only that tile warn", async () => {
  const { summary, summaryText, tiles, values } = await renderHealth({
    ...HEALTHY_SYSTEM,
    backup: { status: "unavailable" },
  });
  assert.equal(summaryText.textContent, "1 needs attention");
  assert.equal(dataState(summary), "warn");
  assert.equal(dataState(tiles.backups), "warn");
  assert.equal(values.backups.textContent, "Unavailable");
  assert.equal(dataState(tiles.storage), "ok");
});

test("multiple problems read N need attention and flip the summary to warn", async () => {
  const { summary, summaryText, tiles } = await renderHealth({
    ...HEALTHY_SYSTEM,
    backup: { status: "unavailable" },
    storage: { status: "unavailable" },
  });
  assert.equal(summaryText.textContent, "2 need attention");
  assert.equal(dataState(summary), "warn");
  assert.equal(dataState(tiles.backups), "warn");
  assert.equal(dataState(tiles.storage), "warn");
});

test("an empty backup stays idle and does not count as needing attention", async () => {
  const { summary, summaryText, tiles } = await renderHealth({
    ...HEALTHY_SYSTEM,
    backup: { status: "empty" },
  });
  assert.equal(summaryText.textContent, "All clear");
  assert.equal(dataState(summary), "ok");
  assert.equal(dataState(tiles.backups), "idle");
});
