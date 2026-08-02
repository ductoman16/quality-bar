import assert from "node:assert/strict";
import { Script } from "node:vm";
import { test } from "node:test";

import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

test("operator pages compile their served classic scripts without collisions", () => {
  for (const view of [
    "evaluations",
    "reviews",
    "repositories",
    "analytics",
    "system",
  ]) {
    const assets = [
      ...operatorPage({ view }).matchAll(
        /<script src="(\/assets\/[^"]+\.js)"><\/script>/g,
      ),
    ].map(([, path]) => path);
    assert.ok(assets.length > 0);
    assert.doesNotThrow(
      () => new Script(assets.map((path) => readBrowserAsset(path)).join("\n")),
      `${view} page scripts must compile as one classic-script bundle`,
    );
  }
});
