import { validateOperatorBrowserFacts } from "./gate-facts.mjs";
import { validatePackageFacts } from "./package-facts.mjs";

export function createGateDefinitions(applicationVersion) {
  return [
    {
      name: "unit",
      testGroup: "browser-authority-and-request-security-unit",
      failureCode: "unit_tests_failed",
      arguments: [
        "--test",
        "test/application-readiness.test.js",
        "test/codex-capabilities.test.js",
        "test/configuration.test.js",
        "test/durable-core.test.js",
        "test/durable-core-transaction.test.js",
        "test/health-live.test.js",
        "test/http-port.test.js",
        "test/installation-environment.test.js",
        "test/operator-password.test.js",
        "test/quality-foundation.test.js",
        "test/browser-session.test.js",
        "test/implementer-token.test.js",
        "test/request-security.test.js",
        "test/review-validation.test.js",
        "test/verification-harness.test.js",
      ],
    },
    {
      name: "browser-component",
      testGroup: "browser-authority-and-request-security-browser-boundary",
      failureCode: "browser_component_tests_failed",
      arguments: [
        "--test",
        "test/browser-assets-browser-component.test.js",
        "test/operator-password-browser-component.test.js",
        "test/browser-session-authentication-browser-component.test.js",
        "test/browser-session-protection-browser-component.test.js",
        "test/browser-session-operator-browser-component.test.js",
      ],
    },
    {
      name: "sqlite-integration",
      testGroup: "review-sqlite-resource-boundary",
      failureCode: "sqlite_integration_tests_failed",
      arguments: ["--test", "test/review.test.js"],
    },
    {
      name: "http-integration",
      testGroup: "review-http-resource-boundary",
      failureCode: "http_integration_tests_failed",
      arguments: ["--test", "test/review-http-integration.test.js"],
    },
    {
      name: "security-integration",
      testGroup: "browser-authority-and-request-security-integration",
      failureCode: "security_integration_tests_failed",
      arguments: [
        "--test",
        "test/operator-password-bootstrap.test.js",
        "test/browser-session-durability-security-integration.test.js",
        "test/browser-session-failure-security-integration.test.js",
        "test/browser-session-proxy-security-integration.test.js",
        "test/browser-session-bearer-security-integration.test.js",
        "test/browser-session-contract-security-integration.test.js",
      ],
    },
    {
      name: "operator-browser-smoke",
      testGroup: "authenticated-firefox-browser-cross-process",
      failureCode: "operator_browser_smoke_failed",
      factsMarker: "QUALITY_BAR_OPERATOR_BROWSER_FACTS",
      validateFacts: validateOperatorBrowserFacts,
      arguments: ["--test", "test/operator-browser-smoke.test.js"],
    },
    {
      name: "package-integration",
      testGroup: "compose-service",
      failureCode: "package_integration_failed",
      factsMarker: "QUALITY_BAR_PACKAGE_FACTS",
      validateFacts: (facts) => validatePackageFacts(facts, applicationVersion),
      arguments: ["--test", "test/package/compose.package-test.mjs"],
    },
    {
      name: "structural-lint",
      testGroup: "maintained-javascript-structure",
      failureCode: "structural_lint_failed",
      arguments: ["--test", "test/structural-lint-gate.test.js"],
    },
    {
      name: "core-javascript-correctness",
      testGroup: "maintained-javascript-correctness",
      failureCode: "core_javascript_correctness_failed",
      arguments: ["--test", "test/core-js-lint-gate.test.js"],
    },
    {
      name: "node-and-ownership-boundaries",
      testGroup: "maintained-javascript-node-and-ownership-boundaries",
      failureCode: "node_and_ownership_boundary_lint_failed",
      arguments: ["--test", "test/node-boundary-lint-gate.test.js"],
    },
    {
      name: "javascript-type-check",
      testGroup: "production-node-and-served-browser-javascript",
      failureCode: "javascript_type_check_failed",
      arguments: ["--test", "test/javascript-type-check-gate.test.js"],
    },
  ];
}
