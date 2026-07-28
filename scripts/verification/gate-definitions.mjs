import { validateOperatorBrowserFacts } from "./gate-facts.mjs";
import { validatePackageFacts } from "./package-facts.mjs";
import { validateApplicationCoverageFacts } from "../application-coverage-report.mjs";
import { APPLICATION_COVERAGE_PROOF_GATE } from "./application-coverage-proof-gate.mjs";
import { forgejoGateDefinitions } from "./forgejo-gate-definition.mjs";
import { requireExactToolVersion } from "./tool-version.mjs";
import { FAKE_CODEX_GATE_DEFINITION } from "./fake-codex-gate-definition.mjs";
import { NODE_OWNERSHIP_LINT_PROOF_GATE } from "./proof-gate-definitions.mjs";
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
 *   coverageToolVersion: string | null,
 *   eslintPluginNodeVersion: string | null,
 *   eslintVersion: string | null,
 *   formatterVersion: string | null,
 *   jsonSchemaFormatsVersion: string | null,
 *   jsonSchemaValidatorVersion: string | null,
 *   openApiValidatorVersion: string | null,
 *   typeCheckerVersion: string | null,
 * }} metadata
 * @returns {GateDefinition[]}
 */
export function createGateDefinitions(metadata) {
  const node = process.version;
  const c8 = requireExactToolVersion(
    metadata.coverageToolVersion,
    "application coverage",
  );
  const eslint = requireExactToolVersion(metadata.eslintVersion, "eslint");
  const eslintPluginNode = requireExactToolVersion(
    metadata.eslintPluginNodeVersion,
    "eslint-plugin-n",
  );
  const prettier = requireExactToolVersion(
    metadata.formatterVersion,
    "prettier",
  );
  const ajv = requireExactToolVersion(
    metadata.jsonSchemaValidatorVersion,
    "JSON Schema validator",
  );
  const ajvFormats = requireExactToolVersion(
    metadata.jsonSchemaFormatsVersion,
    "JSON Schema format validator",
  );
  const openApiValidator = requireExactToolVersion(
    metadata.openApiValidatorVersion,
    "OpenAPI schema validator",
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
      name: "openapi-structure",
      failureCode: "openapi_structure_failed",
      command: "npm",
      arguments: ["run", "openapi:check"],
      checkGroups: [
        {
          name: "published-openapi-document",
          countPattern: /PASS \((\d+) document,/,
          unit: "document",
        },
        {
          name: "published-openapi-operations",
          countPattern: /document, (\d+) operations,/,
          unit: "operation",
        },
        {
          name: "published-openapi-response-statuses",
          countPattern: /operations, (\d+) response statuses;/,
          unit: "response status",
        },
      ],
      tools: {
        ajv,
        "ajv-formats": ajvFormats,
        node,
        "openapi-schema-validator": openApiValidator,
      },
    },
    {
      name: "openapi-runtime-conformance",
      testGroup: "shared-http-request-and-response-conformance",
      failureCode: "openapi_runtime_conformance_failed",
      arguments: ["--test", "test/openapi-conformance.test.js"],
      tools: {
        ajv,
        "ajv-formats": ajvFormats,
        node,
        "openapi-schema-validator": openApiValidator,
      },
    },
    {
      name: "unit",
      testGroup:
        "browser-authority-request-security-review-version-machine-repository-guidance-github-repository-selection-polling-mcp-contract-lifecycle-and-forgejo-pat-rotation-unit",
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
        "test/applicability-rule.test.js",
        "test/repository-collection.test.js",
        "test/review-archival.test.js",
        "test/review-selection.test.js",
        "test/repository-guidance.test.js",
        "test/mcp-contract.test.js",
        "test/review-validation.test.js",
        "test/review-version-reactivation.test.js",
        "test/repository-credential.test.js",
        "test/repository-lifecycle.test.js",
        "test/repository-rotation.test.js",
        "test/repository-validation.test.js",
        "test/github-app-manifest.test.js",
        "test/github-callback-failure.test.js",
        "test/github-connection.test.js",
        "test/github-repository-selection.test.js",
        "test/github-polling-state.test.js",
        "test/forgejo-connection-lifecycle.test.js",
        "test/forgejo-connection.test.js",
        "test/waiver-adjudicator-configuration.test.js",
        "test/verification-harness.test.js",
      ],
    },
    {
      name: "browser-component",
      testGroup:
        "browser-authority-request-security-review-assignment-version-repository-guidance-lifecycle-and-forgejo-connection-lifecycle-browser-boundary",
      failureCode: "browser_component_tests_failed",
      arguments: [
        "--test",
        "test/browser-assets-browser-component.test.js",
        "test/review-metadata-browser-component.test.js",
        "test/review-create-browser-component.test.js",
        "test/review-criterion-retirement-browser-component.test.js",
        "test/review-archival-browser-component.test.js",
        "test/review-applicability-rule-browser-component.test.js",
        "test/review-assignment-browser-component.test.js",
        "test/repository-guidance-browser-component.test.js",
        "test/review-version-reactivation-browser-component.test.js",
        "test/review-version-browser-component.test.js",
        "test/repository-browser-component.test.js",
        "test/repository-lifecycle-browser-component.test.js",
        "test/operator-password-browser-component.test.js",
        "test/browser-session-authentication-browser-component.test.js",
        "test/browser-session-protection-browser-component.test.js",
        "test/browser-session-operator-browser-component.test.js",
        "test/github-connection-browser-component.test.js",
        "test/github-repository-reconciliation-browser-component.test.js",
        "test/github-repository-browser-component.test.js",
        "test/forgejo-connection-browser-component.test.js",
        "test/waiver-adjudicator-configuration-browser-component.test.js",
      ],
    },
    FAKE_CODEX_GATE_DEFINITION,
    {
      name: "github-fixture-integration",
      testGroup:
        "github-rest-profile-personal-installation-permissions-routes-pagination-rate-gates-atomic-selection-enumeration-and-private-git-boundary",
      failureCode: "github_fixture_integration_tests_failed",
      arguments: [
        "--test",
        "test/github-fixture-integration.test.js",
        "test/github-polling-fixture-integration.test.js",
        "test/github-private-proof-failure-fixture-integration.test.js",
      ],
    },
    ...forgejoGateDefinitions,
    {
      name: "git-integration",
      testGroup:
        "generic-and-github-app-https-repository-read-guidance-assignment-lifecycle-and-polling-object-identity-boundary",
      failureCode: "git_integration_tests_failed",
      arguments: [
        "--test",
        "test/repository-git-integration.test.js",
        "test/github-git-integration.test.js",
        "test/repository-git-credential-integration.test.js",
      ],
    },
    {
      name: "sqlite-integration",
      testGroup:
        "review-assignment-version-guidance-credential-github-repository-selection-polling-repository-lifecycle-and-forgejo-connection-lifecycle-sqlite-resource-boundary",
      failureCode: "sqlite_integration_tests_failed",
      arguments: [
        "--test",
        "test/review-criterion-identity.test.js",
        "test/review-archival-sqlite-integration.test.js",
        "test/review-applicability-rule-sqlite-integration.test.js",
        "test/review-assignment-sqlite-integration.test.js",
        "test/repository-guidance-sqlite-integration.test.js",
        "test/review-schema-migration.test.js",
        "test/review-version-change-detection.test.js",
        "test/review-version-reactivation-sqlite-integration.test.js",
        "test/review.test.js",
        "test/repository-credential-rotation-sqlite-integration.test.js",
        "test/repository-sqlite-integration.test.js",
        "test/github-connection-sqlite-integration.test.js",
        "test/github-connection-verification-sqlite-integration.test.js",
        "test/github-repository-migration-sqlite-integration.test.js",
        "test/github-repository-selection-sqlite-integration.test.js",
        "test/github-polling.test.js",
        "test/forgejo-connection-rotation-sqlite-integration.test.js",
        "test/forgejo-connection-lifecycle-sqlite-integration.test.js",
        "test/forgejo-connection-schema-migration.test.js",
        "test/forgejo-connection-sqlite-integration.test.js",
        "test/waiver-adjudicator-configuration-sqlite-integration.test.js",
      ],
    },
    {
      name: "http-integration",
      testGroup:
        "review-assignment-version-machine-repository-guidance-repository-lifecycle-and-forgejo-connection-lifecycle-http-resource-boundary",
      failureCode: "http_integration_tests_failed",
      arguments: [
        "--test",
        "test/repository-http-integration.test.js",
        "test/repository-guidance-http-integration.test.js",
        "test/repository-lifecycle-http-integration.test.js",
        "test/review-authorization-http-integration.test.js",
        "test/review-archival-http-integration.test.js",
        "test/review-applicability-rule-http-integration.test.js",
        "test/review-assignment-http-integration.test.js",
        "test/review-criterion-retirement-http-integration.test.js",
        "test/review-version-reactivation-http-integration.test.js",
        "test/review-http-integration.test.js",
        "test/github-connection-http-integration.test.js",
        "test/forgejo-connection-http-integration.test.js",
        "test/waiver-adjudicator-configuration-http-integration.test.js",
      ],
    },
    {
      name: "mcp-integration",
      testGroup:
        "authenticated-streamable-http-mcp-repository-guidance-resource-and-security-boundary",
      failureCode: "mcp_integration_tests_failed",
      arguments: [
        "--test",
        "test/mcp-http-integration.test.js",
        "test/mcp-security-integration.test.js",
      ],
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
      name: "application-coverage",
      testGroup: "maintained-server-and-served-browser-application",
      failureCode: "application_coverage_failed",
      command: "npm",
      factsMarker: "QUALITY_BAR_APPLICATION_COVERAGE_FACTS",
      validateFacts: validateApplicationCoverageFacts,
      arguments: ["run", "coverage"],
      tools: { c8, node },
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
    NODE_OWNERSHIP_LINT_PROOF_GATE,
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
    APPLICATION_COVERAGE_PROOF_GATE,
  ];
}
