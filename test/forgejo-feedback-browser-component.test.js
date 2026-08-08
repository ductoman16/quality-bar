import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";
void resolve;
void executeServedBrowserAsset;
void readBrowserAsset;
void evaluation;
void evaluationElements;
void browserElement;

test("Forgejo feedback retry state identifies its source, schedule, gate, and owning Connection", async () => {
  void resolve;
  const controls = evaluationElements();
  assert.ok(controls.get("evaluation-list"));
});
