import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CODEX_CAPABILITY_CATALOG,
  CodexConfigurationError,
  readCodexCapabilityCatalog,
  validateCodexConfiguration,
} from "../src/codex-capabilities.js";

test("the pinned Codex catalog offers only exact model-compatible settings", () => {
  assert.deepEqual(CODEX_CAPABILITY_CATALOG, {
    codex_cli_version: "0.145.0",
    models: [
      {
        id: "gpt-5.6-sol",
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        service_tiers: ["standard", "fast"],
      },
      {
        id: "gpt-5.6-terra",
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        service_tiers: ["standard", "fast"],
      },
      {
        id: "gpt-5.6-luna",
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        service_tiers: ["standard", "fast"],
      },
    ],
  });

  assert.deepEqual(
    validateCodexConfiguration({
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "fast",
    }),
    {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "fast",
    },
  );
});

test("Codex configuration validation never normalizes, inherits, substitutes, or falls back", () => {
  const inheritedModel = Object.assign(
    Object.create({ model: "gpt-5.6-terra" }),
    {
      reasoning_effort: "high",
      service_tier: "standard",
      unexpected: "value",
    },
  );
  for (const [configuration, code] of [
    [{ model: "gpt-5.6-terra", reasoning_effort: "ultra", service_tier: "standard" }, "codex_reasoning_effort_unsupported"],
    [{ model: "gpt-5.6-terra", reasoning_effort: "high", service_tier: "priority" }, "codex_service_tier_unsupported"],
    [{ model: "gpt-5.6-terra-latest", reasoning_effort: "high", service_tier: "standard" }, "codex_model_unsupported"],
    [{ model: "gpt-5.3-codex", reasoning_effort: "high", service_tier: "standard" }, "codex_model_unsupported"],
    [{ model: "GPT-5.6-TERRA", reasoning_effort: "high", service_tier: "standard" }, "codex_model_unsupported"],
    [{ model: "gpt-5.6-terra", reasoning_effort: "high" }, "codex_configuration_malformed"],
    [{ model: "gpt-5.6-terra", reasoning_effort: "high", service_tier: "standard", fallback: true }, "codex_configuration_malformed"],
    [inheritedModel, "codex_configuration_malformed"],
  ]) {
    assert.throws(
      () => validateCodexConfiguration(configuration),
      (error) => error instanceof CodexConfigurationError && error.code === code,
    );
  }
});

test("catalog readers receive a fresh immutable-compatible snapshot", () => {
  const first = readCodexCapabilityCatalog();
  first.models[0].reasoning_efforts.pop();

  assert.deepEqual(readCodexCapabilityCatalog(), CODEX_CAPABILITY_CATALOG);
});
