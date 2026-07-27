import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FakeCustomEvent,
  reviewVersionBrowserHarness,
} from "./review-browser-component-support.js";

test("the Review Version component confirms retirement and adds a replacement identity", async () => {
  /** @type {string[]} */
  const confirmations = [];
  const decisions = [false, true];
  const {
    addCriterion,
    criteriaList,
    documentListeners,
    form,
    requests,
    resolveFirstSave,
    saved,
  } = reviewVersionBrowserHarness({
    confirm(message) {
      confirmations.push(message);
      return decisions.shift() ?? true;
    },
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

  const firstRetire = /** @type {any} */ (criteriaList.children[0]).children[6];
  firstRetire.listener("click")({});
  assert.equal(criteriaList.children.length, 2);
  firstRetire.listener("click")({});
  assert.equal(criteriaList.children.length, 1);
  assert.deepEqual(confirmations, [
    "Retire Criterion 1 from the next Review Version?",
    "Retire Criterion 1 from the next Review Version?",
  ]);
  assert.equal(
    /** @type {any} */ (criteriaList.children[0]).children[6].disabled,
    true,
  );

  addCriterion.listener("click")({});
  assert.equal(criteriaList.children.length, 2);
  const replacementInstruction = /** @type {any} */ (criteriaList.children[1])
    .children[0];
  replacementInstruction.value = "Use the replacement meaning.";
  replacementInstruction.listener("input")({});
  assert.equal(replacementInstruction.focused, true);

  const pendingSave = form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(
    JSON.parse(/** @type {any} */ (requests[1]).options.body).criteria,
    [
      {
        id: "criterion-stable-two",
        impact: "blocking",
        instruction: "Keep durable writes atomic.",
      },
      {
        impact: "advisory",
        instruction: "Use the replacement meaning.",
      },
    ],
  );
  resolveFirstSave({
    ok: true,
    status: 200,
    async json() {
      return { changed: true, review: saved };
    },
  });
  await pendingSave;
});
