export {
  responseErrorCode,
  sessionCookies,
  startApplication,
} from "./http-integration-support.js";

/** @param {Record<string, unknown>} [overrides] */
export function reviewRequest(overrides = {}) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "advisory",
        instruction: "Preserve request authentication boundaries.",
      },
    ],
    description: "Keep authenticated mutations safe.",
    name: "HTTP boundaries",
    ...overrides,
  };
}
