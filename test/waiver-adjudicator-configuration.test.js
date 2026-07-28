import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createWaiverAdjudicatorConfigurationService,
  WaiverAdjudicatorConfigurationError,
} from "../src/waiver-adjudicator-configuration.js";

function configuration(overrides = {}) {
  return {
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    service_tier: "standard",
    ...overrides,
  };
}

function configurationCore() {
  /** @type {Record<string, any> | undefined} */
  let row;
  return {
    get() {
      return row ? { ...row } : undefined;
    },
    /** @param {(transaction: any) => any} callback */
    transaction(callback) {
      return callback({
        get() {
          return row ? { ...row } : undefined;
        },
        /** @param {string} sql @param {any} model @param {any} reasoningEffort @param {any} serviceTier @param {any} updatedAt */
        run(sql, model, reasoningEffort, serviceTier, updatedAt) {
          assert.match(sql, /waiver_adjudicator_configuration/);
          row = {
            model,
            reasoning_effort: reasoningEffort,
            service_tier: serviceTier,
            updated_at: updatedAt,
          };
          return { changes: 1 };
        },
      });
    },
  };
}

test("one installation-wide Waiver Adjudicator Configuration freezes exact later launch values", () => {
  let timestamp = 40;
  const service = createWaiverAdjudicatorConfigurationService(
    configurationCore(),
    { now: () => ++timestamp },
  );

  assert.deepEqual(service.read(), { configured: false });
  assert.throws(
    () => service.freezeForAdjudication(),
    (error) =>
      error instanceof WaiverAdjudicatorConfigurationError &&
      error.code === "waiver_adjudicator_configuration_required",
  );

  assert.deepEqual(service.update(configuration()), {
    changed: true,
    configuration: configuration(),
  });
  const firstAdjudication = service.freezeForAdjudication();

  assert.deepEqual(
    service.update(
      configuration({
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
        service_tier: "fast",
      }),
    ),
    {
      changed: true,
      configuration: configuration({
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
        service_tier: "fast",
      }),
    },
  );
  assert.deepEqual(firstAdjudication, configuration());
  assert.deepEqual(service.freezeForAdjudication(), {
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    service_tier: "fast",
  });
  assert.deepEqual(
    service.update(
      configuration({
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
        service_tier: "fast",
      }),
    ),
    {
      changed: false,
      configuration: configuration({
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
        service_tier: "fast",
      }),
    },
  );
});

test("Waiver Adjudicator Configuration rejects every override and unsupported exact value", () => {
  const service =
    createWaiverAdjudicatorConfigurationService(configurationCore());

  for (const [candidate, code] of [
    [
      { ...configuration(), repository_id: "repository-1" },
      "codex_configuration_malformed",
    ],
    [
      configuration({ model: "gpt-5.6-terra-latest" }),
      "codex_model_unsupported",
    ],
    [
      configuration({ reasoning_effort: "ultra" }),
      "codex_reasoning_effort_unsupported",
    ],
    [
      configuration({ service_tier: "priority" }),
      "codex_service_tier_unsupported",
    ],
  ]) {
    assert.throws(
      () => service.update(candidate),
      (error) =>
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === code,
    );
    assert.deepEqual(service.read(), { configured: false });
  }
});
