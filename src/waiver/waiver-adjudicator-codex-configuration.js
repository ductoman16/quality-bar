import { validateCodexConfiguration } from "../codex/codex-capabilities.js";

/** @param {unknown} candidate */
export function waiverAdjudicatorCodexConfigurationArguments(candidate) {
  const configuration = validateCodexConfiguration(candidate);
  return [
    "--ignore-user-config",
    "--model",
    configuration.model,
    "--config",
    `model_reasoning_effort="${configuration.reasoning_effort}"`,
    "--config",
    `service_tier="${configuration.service_tier}"`,
  ];
}
