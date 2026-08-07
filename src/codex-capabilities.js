const MODEL_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "gpt-5.6-sol",
    reasoning_efforts: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
    service_tiers: Object.freeze(["standard", "fast"]),
  }),
  Object.freeze({
    id: "gpt-5.6-terra",
    reasoning_efforts: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
    service_tiers: Object.freeze(["standard", "fast"]),
  }),
  Object.freeze({
    id: "gpt-5.6-luna",
    reasoning_efforts: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
    service_tiers: Object.freeze(["standard", "fast"]),
  }),
]);

export const CODEX_CAPABILITY_CATALOG = Object.freeze({
  codex_cli_version: "0.145.0",
  models: MODEL_CAPABILITIES,
});

export class CodexConfigurationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "CodexConfigurationError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new CodexConfigurationError(code, message);
}

/**
 * @param {unknown} value
 * @returns {value is {
 *   model: string,
 *   reasoning_effort: string,
 *   service_tier: string
 * }}
 */
function isExactConfiguration(value) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const configuration = /** @type {Record<string, unknown>} */ (value);
  return (
    Object.keys(configuration).length === 3 &&
    ["model", "reasoning_effort", "service_tier"].every(
      (key) =>
        Object.hasOwn(configuration, key) &&
        typeof configuration[key] === "string",
    )
  );
}

/** @returns {{
 *   codex_cli_version: string,
 *   models: Array<{
 *     id: string,
 *     reasoning_efforts: string[],
 *     service_tiers: string[]
 *   }>
 * }} */
export function readCodexCapabilityCatalog() {
  return {
    codex_cli_version: CODEX_CAPABILITY_CATALOG.codex_cli_version,
    models: CODEX_CAPABILITY_CATALOG.models.map((model) => ({
      id: model.id,
      reasoning_efforts: [...model.reasoning_efforts],
      service_tiers: [...model.service_tiers],
    })),
  };
}

/** @param {unknown} configuration */
export function validateCodexConfiguration(configuration) {
  if (!isExactConfiguration(configuration)) {
    fail(
      "codex_configuration_malformed",
      "Codex configuration must contain only exact model, reasoning_effort, and service_tier values",
    );
  }

  const model = MODEL_CAPABILITIES.find(({ id }) => id === configuration.model);
  if (!model) {
    fail(
      "codex_model_unsupported",
      "Codex model is not supported by the pinned catalog",
    );
  }
  if (!model.reasoning_efforts.includes(configuration.reasoning_effort)) {
    fail(
      "codex_reasoning_effort_unsupported",
      "Codex reasoning effort is not supported by the selected model",
    );
  }
  if (!model.service_tiers.includes(configuration.service_tier)) {
    fail(
      "codex_service_tier_unsupported",
      "Codex service tier is not supported by the selected model",
    );
  }

  return {
    model: configuration.model,
    reasoning_effort: configuration.reasoning_effort,
    service_tier: configuration.service_tier,
  };
}
