import { validateOperatorBrowserFacts } from "./gate-facts.mjs";
import { validatePackageFacts } from "./package-facts.mjs";

/** @param {string | null} version @param {string} tool */
function requireExactToolVersion(version, tool) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `verification metadata must include an exact ${tool} version`,
    );
  }
  return version;
}

/**
 * @typedef {{
 *   name: string,
 *   testGroup?: string,
 *   checkGroups?: {
 *     name: string,
 *     count?: number,
 *     countPattern?: RegExp,
 *     unit: string,
 *   }[],
 *   failureCode: string,
 *   command?: string,
 *   arguments: string[],
 *   tools?: Record<string, string>,
 *   factsMarker?: string,
 *   validateFacts?: (facts: unknown) => string | null,
 * }} GateDefinition
 */

/**
 * @param {{
 *   applicationVersion: string | null,
 *   eslintPluginNodeVersion: string | null,
 *   eslintVersion: string | null,
 *   formatterVersion: string | null,
 *   typeCheckerVersion: string | null,
 * }} metadata
 * @returns {GateDefinition[]}
 */
export function createGateDefinitions(metadata) {
  const node = process.version;
  const eslint = requireExactToolVersion(metadata.eslintVersion, "eslint");
  const eslintPluginNode = requireExactToolVersion(
    metadata.eslintPluginNodeVersion,
    "eslint-plugin-n",
  );
  const prettier = requireExactToolVersion(
    metadata.formatterVersion,
    "prettier",
  );
  const typescript = requireExactToolVersion(
    metadata.typeCheckerVersion,
    "typescript",
  );

  return [
    {
      name: "formatting",
      failureCode: "formatting_failed",
      command: "npm",
      arguments: ["run", "format:check"],
      checkGroups: [
        { name: "repository-format", count: 1, unit: "repository" },
      ],
      tools: { node, prettier },
    },
    {
      name: "structural-lint",
      failureCode: "structural_lint_failed",
      command: "npm",
      arguments: ["run", "lint:structure"],
      checkGroups: [
        {
          name: "maintained-javascript-structure",
          countPattern: /PASS \((\d+) maintained JavaScript files,/,
          unit: "file",
        },
      ],
      tools: { eslint, node },
    },
    {
      name: "correctness-lint",
      failureCode: "correctness_lint_failed",
      command: "npm",
      arguments: ["run", "lint:correctness"],
      checkGroups: [
        {
          name: "maintained-javascript-correctness",
          countPattern: /PASS \((\d+) maintained JavaScript files,/,
          unit: "file",
        },
      ],
      tools: { eslint, node },
    },
    {
      name: "node-ownership-lint",
      failureCode: "node_ownership_lint_failed",
      command: "npm",
      arguments: ["run", "lint:boundaries"],
      checkGroups: [
        {
          name: "maintained-javascript-node-and-ownership-boundaries",
          countPattern: /PASS \((\d+) maintained JavaScript files,/,
          unit: "file",
        },
      ],
      tools: { eslint, "eslint-plugin-n": eslintPluginNode, node },
    },
    {
      name: "production-type-check",
      failureCode: "production_type_check_failed",
      command: "npm",
      arguments: ["run", "typecheck:production"],
      checkGroups: [
        { name: "production-node-javascript", count: 1, unit: "project" },
        {
          name: "served-browser-javascript",
          count: 1,
          unit: "project",
        },
      ],
      tools: { node, typescript },
    },
    {
      name: "proof-code-type-check",
      failureCode: "proof_code_type_check_failed",
      command: "npm",
      arguments: ["run", "typecheck:proof"],
      checkGroups: [
        { name: "maintained-test-javascript", count: 1, unit: "project" },
        {
          name: "extracted-browser-test-probe",
          count: 1,
          unit: "project",
        },
        {
          name: "verification-and-package-proof-javascript",
          count: 1,
          unit: "project",
        },
      ],
      tools: { node, typescript },
    },
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
      validateFacts: (facts) =>
        validatePackageFacts(facts, metadata.applicationVersion),
      arguments: ["--test", "test/package/compose.package-test.mjs"],
    },
    {
      name: "structural-lint-proof",
      testGroup: "maintained-javascript-structure",
      failureCode: "structural_lint_proof_failed",
      arguments: ["--test", "test/structural-lint-gate.test.js"],
    },
    {
      name: "correctness-lint-proof",
      testGroup: "maintained-javascript-correctness",
      failureCode: "correctness_lint_proof_failed",
      arguments: ["--test", "test/core-js-lint-gate.test.js"],
    },
    {
      name: "node-ownership-lint-proof",
      testGroup: "maintained-javascript-node-and-ownership-boundaries",
      failureCode: "node_ownership_lint_proof_failed",
      arguments: ["--test", "test/node-boundary-lint-gate.test.js"],
    },
    {
      name: "production-type-check-proof",
      testGroup: "production-node-and-served-browser-javascript",
      failureCode: "production_type_check_proof_failed",
      arguments: ["--test", "test/javascript-type-check-gate.test.js"],
    },
    {
      name: "proof-code-type-check-proof",
      testGroup: "maintained-test-verification-and-proof-javascript",
      failureCode: "proof_code_type_check_proof_failed",
      arguments: ["--test", "test/test-verification-type-check-gate.test.js"],
    },
  ];
}
