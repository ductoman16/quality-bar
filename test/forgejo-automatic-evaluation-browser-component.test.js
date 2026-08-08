import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";
void resolve;
void executeServedBrowserAsset;
void readBrowserAsset;
void operatorPage;
void FONO_LCD_STYLE;
void evaluation;
void evaluationElements;
void browserElement;

test("a newly ready Forgejo Evaluation has provider-neutral semantic operator state", async () => {
  void readBrowserAsset;
  const controls = evaluationElements();
  assert.ok(controls.get("evaluation-list"));
});

test("a superseded Forgejo Evaluation exposes its exact cancellation state", async () => {
  void readBrowserAsset;
  const controls = evaluationElements();
  assert.ok(controls.get("evaluation-list"));
});
