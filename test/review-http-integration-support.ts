export {
  authenticatedOperatorHeaders,
  responseErrorCode,
  sessionCookies,
  startApplication,
} from "./http-integration-support.ts";

export function reviewRequest(overrides: Record<string, unknown> = {}) {
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
