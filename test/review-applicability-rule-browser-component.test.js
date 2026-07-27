import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failureResponse,
  FakeCustomEvent,
  reviewVersionBrowserHarness,
} from "./review-browser-component-support.js";

test("the Review Version component surfaces the exact restricted CEL save failure", async () => {
  const message =
    "Applicability Rule must parenthesize every mixed && and || expression";
  const {
    applicabilityRule,
    documentListeners,
    error,
    form,
    requests,
    result,
  } = reviewVersionBrowserHarness({
    versionResponses: [
      failureResponse(
        "review_applicability_rule_parentheses_required",
        message,
        422,
      ),
    ],
  });
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
          ],
        },
      },
    }),
  );
  applicabilityRule.value =
    "file_changes.exists(file, file.modified) && true || false";

  await form.listener("submit")({ preventDefault() {} });

  assert.equal(requests.length, 2);
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, message);
  assert.equal(result.textContent, "");
});
