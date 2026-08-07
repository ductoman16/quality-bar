import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FakeCustomEvent,
  reviewResource,
  reviewVersionBrowserHarness,
} from "./review-browser-component-support.js";

test("the Review Version component submits the selected complete executable snapshot", async () => {
  const {
    applicabilityRule,
    created,
    criteriaList,
    destinations,
    document,
    documentListeners,
    error,
    form,
    model,
    reasoningEffort,
    requests,
    resolveFirstSave,
    result,
    saved,
    selector,
    serviceTier,
  } = reviewVersionBrowserHarness();

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  await assert.rejects(
    async () => systemLoaded({}),
    /system_loaded_event_invalid/,
  );
  await assert.rejects(
    async () =>
      systemLoaded(
        new FakeCustomEvent("quality-bar:system-loaded", { detail: {} }),
      ),
    /system_loaded_event_invalid/,
  );
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
            {
              id: "gpt-5.6-sol",
              reasoning_efforts: ["xhigh"],
              service_tiers: ["fast"],
            },
          ],
        },
      },
    }),
  );
  assert.equal(form.hidden, false, String(error.textContent));
  assert.equal(selector.value, "review/one");
  assert.equal(model.value, "gpt-5.6-terra");
  assert.equal(reasoningEffort.value, "high");
  assert.equal(serviceTier.value, "standard");
  assert.equal(applicabilityRule.value, "");
  assert.equal(criteriaList.children.length, 2);

  let [firstCriterion, secondCriterion] = criteriaList.children;
  assert.ok(firstCriterion);
  assert.ok(secondCriterion);
  const [firstInstruction, firstInstructionError, firstImpact, firstHandle] =
    /** @type {any} */ (firstCriterion).children;
  assert.throws(
    () => /** @type {any} */ (firstCriterion).children[6].listener("click")({}),
    /review_criterion_confirmation_unexpected/,
  );
  assert.equal(firstInstruction.value, "Preserve the exact metadata boundary.");
  assert.equal(firstInstruction["aria-describedby"], firstInstructionError.id);
  assert.equal(firstInstruction["aria-required"], "true");
  assert.equal(firstInstruction.required, undefined);
  assert.equal(firstInstructionError.hidden, true);
  assert.equal(firstImpact.value, "advisory");
  assert.equal(firstHandle.draggable, true);

  firstInstruction.value = "Preserve the exact Criterion identity.";
  firstInstruction.listener("input")({});
  firstImpact.value = "blocking";
  firstImpact.listener("change")({});

  assert.throws(
    () =>
      /** @type {any} */ (firstCriterion).listener("drop")({
        preventDefault() {},
      }),
    /review_criterion_drag_invalid/,
  );
  const dragData = {
    effectAllowed: "",
    /** @type {Array<[string, string]>} */
    values: [],
    /** @param {string} type @param {string} value */
    setData(type, value) {
      this.values.push([type, value]);
    },
  };
  firstHandle.listener("dragstart")({ dataTransfer: dragData });
  assert.equal(dragData.effectAllowed, "move");
  assert.deepEqual(dragData.values, [["text/plain", "criterion-stable-one"]]);
  firstHandle.listener("dragend")({});
  assert.throws(
    () =>
      /** @type {any} */ (secondCriterion).listener("drop")({
        preventDefault() {},
      }),
    /review_criterion_drag_invalid/,
  );
  firstHandle.listener("dragstart")({ dataTransfer: dragData });
  /** @type {any} */ (secondCriterion).listener("dragover")({
    preventDefault() {},
  });
  /** @type {any} */ (secondCriterion).listener("drop")({
    preventDefault() {},
  });
  [firstCriterion, secondCriterion] = criteriaList.children;
  assert.equal(
    /** @type {any} */ (firstCriterion).children[0].value,
    "Keep durable writes atomic.",
  );
  assert.equal(/** @type {any} */ (secondCriterion).children[3].focused, true);

  const moveFirstDown = /** @type {any} */ (firstCriterion).children[5];
  moveFirstDown.listener("click")({});
  [firstCriterion, secondCriterion] = criteriaList.children;
  assert.equal(
    /** @type {any} */ (firstCriterion).children[0].value,
    "Preserve the exact Criterion identity.",
  );
  assert.equal(/** @type {any} */ (secondCriterion).children[4].focused, true);
  assert.equal(
    /** @type {any} */ (firstCriterion).children[4].textContent,
    "Move Criterion 1 up",
  );
  assert.equal(
    /** @type {any} */ (secondCriterion).children[5].textContent,
    "Move Criterion 2 down",
  );
  /** @type {any} */ (secondCriterion).children[4].listener("click")({});
  [firstCriterion, secondCriterion] = criteriaList.children;
  assert.equal(
    /** @type {any} */ (firstCriterion).children[0].value,
    "Keep durable writes atomic.",
  );
  assert.equal(/** @type {any} */ (firstCriterion).children[5].focused, true);
  /** @type {any} */ (firstCriterion).children[5].listener("click")({});

  [firstCriterion] = criteriaList.children;
  const invalidInstruction = /** @type {any} */ (firstCriterion).children[0];
  const invalidInstructionError = /** @type {any} */ (firstCriterion)
    .children[1];
  invalidInstruction.value = " ";
  invalidInstruction.listener("input")({});
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(
    /** @type {any} */ (error.children[0]).href,
    "#" + invalidInstruction.id,
  );
  assert.equal(invalidInstructionError.hidden, false);
  assert.equal(invalidInstruction.focused, true);
  invalidInstruction.value = "Preserve the exact Criterion identity.";
  invalidInstruction.listener("input")({});

  model.value = "gpt-5.6-sol";
  model.listener("change")({});
  applicabilityRule.value = "true";
  const pendingSave = form.listener("submit")({ preventDefault() {} });
  const reviewCreatedListener = documentListeners.get(
    "quality-bar:review-created",
  );
  assert.ok(reviewCreatedListener);
  reviewCreatedListener(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: reviewResource({
        description: "Another editable Review.",
        id: "review-race",
        name: "Race Review",
      }),
    }),
  );
  const raceInstruction = /** @type {any} */ (criteriaList.children[0])
    .children[0];
  raceInstruction.value = "Keep this local edit.";
  raceInstruction.listener("input")({});
  resolveFirstSave({
    ok: true,
    status: 200,
    async json() {
      return { changed: true, review: saved };
    },
  });
  await pendingSave;

  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({
        applicability_rule: "true",
        codex_configuration: {
          model: "gpt-5.6-sol",
          reasoning_effort: "xhigh",
          service_tier: "fast",
        },
        criteria: [
          {
            id: "criterion-stable-one",
            impact: "blocking",
            instruction: "Preserve the exact Criterion identity.",
          },
          {
            id: "criterion-stable-two",
            impact: "blocking",
            instruction: "Keep durable writes atomic.",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/reviews/review%2Fone/versions",
  });
  assert.equal(selector.value, "review-race");
  assert.equal(raceInstruction.value, "Keep this local edit.");
  assert.equal(result.textContent, "");
  assert.equal(error.hidden, true);

  selector.value = "review/one";
  selector.listener("change")({});
  const staleReviewCreated = documentListeners.get(
    "quality-bar:review-created",
  );
  assert.ok(staleReviewCreated);
  staleReviewCreated(
    new FakeCustomEvent("quality-bar:review-created", { detail: created }),
  );
  model.value = "gpt-5.6-sol";
  model.listener("change")({});
  applicabilityRule.value = "true";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(result.textContent, "Executable boundaries v2 unchanged.");
  assert.equal(error.hidden, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(
    /** @type {any} */ (error.children[0]).textContent,
    "Criterion 1 instruction must be nonblank",
  );
  assert.equal(
    /** @type {any} */ (criteriaList.children[0]).children[1].textContent,
    "Criterion 1 instruction must be nonblank",
  );
  assert.equal(error.hidden, false);
  assert.equal(result.textContent, "");

  const staleFailure = form.listener("submit")({ preventDefault() {} });
  reviewCreatedListener(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: reviewResource({
        description: "Another editable Review.",
        id: "review-race",
        name: "Race Review",
      }),
    }),
  );
  const preservedInstruction = /** @type {any} */ (criteriaList.children[0])
    .children[0];
  preservedInstruction.value = "Keep this edit after failure.";
  preservedInstruction.listener("input")({});
  await staleFailure;
  assert.equal(
    error.textContent,
    "Review review/one: Review storage is unavailable",
  );
  assert.equal(preservedInstruction.value, "Keep this edit after failure.");
  selector.value = "review/one";
  selector.listener("change")({});

  document.cookie = "";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "browser_csrf_unavailable");
  document.cookie = "quality_bar_configured_csrf=csrf-token";

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Review Version response was invalid");
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(destinations, ["/?return_to=%2F%3Fview%3Dreviews"]);

  const reviewCreated = documentListeners.get("quality-bar:review-created");
  assert.ok(reviewCreated);
  assert.throws(() => reviewCreated({}), /review_created_event_invalid/);
  reviewCreated(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: reviewResource({
        description: "A second Review.",
        id: "review-two",
        name: "Second Review",
      }),
    }),
  );
  assert.equal(selector.value, "review-two");
  assert.equal(error.hidden, true);
  assert.equal(error.textContent, "");
  assert.equal(result.textContent, "");
  selector.value = "missing-review";
  assert.throws(
    () => selector.listener("change")({}),
    /review_selection_invalid/,
  );
  model.value = "missing-model";
  assert.throws(
    () => model.listener("change")({}),
    /Review model capability is unavailable/,
  );

  const catalog = {
    models: [
      {
        id: "gpt-5.6-terra",
        reasoning_efforts: ["high"],
        service_tiers: ["standard"],
      },
    ],
  };
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: { catalog },
    }),
  );
  assert.equal(error.textContent, "Review storage is unavailable");
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: { catalog },
    }),
  );
  assert.equal(error.textContent, "Review Version response was invalid");
});
