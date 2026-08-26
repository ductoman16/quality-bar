import { validateCodexConfiguration } from "../codex/codex-capabilities.ts";

export function waiverAdjudicatorCodexConfigurationArguments(
  candidate: unknown,
) {
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
