import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { BROWSER_ASSET_SOURCE_PATHS } from "../src/browser-assets.js";

export const APPLICATION_COVERAGE_BOUNDARY = Object.freeze({
  include: Object.freeze(["src/**/*.js"]),
  excludedRoots: Object.freeze([
    "artifacts",
    "evidence",
    "fixtures",
    "scripts",
    "test",
  ]),
  servedBrowserAssets: Object.freeze([...BROWSER_ASSET_SOURCE_PATHS]),
});

export const APPLICATION_COVERAGE_TEST_PATHS = Object.freeze([
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
  "test/github-app-manifest.test.js",
  "test/github-callback-failure.test.js",
  "test/github-connection.test.js",
  "test/github-repository-selection.test.js",
  "test/github-polling-state.test.js",
  "test/github-polling.test.js",
  "test/github-polling-fixture-integration.test.js",
  "test/github-fixture-integration.test.js",
  "test/review-validation.test.js",
  "test/review-archival.test.js",
  "test/review-selection.test.js",
  "test/repository-guidance.test.js",
  "test/mcp-contract.test.js",
  "test/review-archival-browser-component.test.js",
  "test/review-applicability-rule-browser-component.test.js",
  "test/review-assignment-browser-component.test.js",
  "test/repository-guidance-browser-component.test.js",
  "test/review-archival-sqlite-integration.test.js",
  "test/review-applicability-rule-sqlite-integration.test.js",
  "test/review-assignment-sqlite-integration.test.js",
  "test/repository-guidance-sqlite-integration.test.js",
  "test/review-archival-http-integration.test.js",
  "test/review-applicability-rule-http-integration.test.js",
  "test/review-assignment-http-integration.test.js",
  "test/repository-guidance-http-integration.test.js",
  "test/mcp-http-integration.test.js",
  "test/mcp-security-integration.test.js",
  "test/review-schema-migration.test.js",
  "test/review-criterion-identity.test.js",
  "test/review-criterion-retirement-browser-component.test.js",
  "test/review-criterion-retirement-http-integration.test.js",
  "test/review-version-change-detection.test.js",
  "test/review-version-reactivation.test.js",
  "test/repository-validation.test.js",
  "test/repository-lifecycle.test.js",
  "test/repository-rotation.test.js",
  "test/repository-git-integration.test.js",
  "test/repository-git-credential-integration.test.js",
  "test/repository-browser-component.test.js",
  "test/github-connection-browser-component.test.js",
  "test/github-repository-browser-component.test.js",
  "test/repository-http-integration.test.js",
  "test/github-connection-http-integration.test.js",
  "test/repository-lifecycle-browser-component.test.js",
  "test/repository-lifecycle-http-integration.test.js",
  "test/repository-credential-rotation-sqlite-integration.test.js",
  "test/repository-sqlite-integration.test.js",
  "test/github-connection-sqlite-integration.test.js",
  "test/github-connection-verification-sqlite-integration.test.js",
  "test/github-repository-migration-sqlite-integration.test.js",
  "test/github-repository-selection-sqlite-integration.test.js",
  "test/review-version-reactivation-browser-component.test.js",
  "test/review-version-reactivation-sqlite-integration.test.js",
  "test/review-version-reactivation-http-integration.test.js",
  "test/browser-assets-browser-component.test.js",
  "test/review-metadata-browser-component.test.js",
  "test/review-create-browser-component.test.js",
  "test/review-version-browser-component.test.js",
  "test/operator-password-browser-component.test.js",
  "test/browser-session-authentication-browser-component.test.js",
  "test/browser-session-protection-browser-component.test.js",
  "test/browser-session-operator-browser-component.test.js",
  "test/review.test.js",
  "test/review-authorization-http-integration.test.js",
  "test/review-http-integration.test.js",
  "test/operator-password-bootstrap.test.js",
  "test/browser-session-durability-security-integration.test.js",
  "test/browser-session-failure-security-integration.test.js",
  "test/browser-session-proxy-security-integration.test.js",
  "test/browser-session-bearer-security-integration.test.js",
  "test/browser-session-contract-security-integration.test.js",
]);

/**
 * @param {string} repositoryRoot
 * @param {string} sourcePath
 * @param {string} servedSource
 * @param {object} context
 */
export function executeServedBrowserAsset(
  repositoryRoot,
  sourcePath,
  servedSource,
  context,
) {
  if (!APPLICATION_COVERAGE_BOUNDARY.servedBrowserAssets.includes(sourcePath)) {
    throw new Error(
      `application_coverage_unreviewed_browser_asset: ${sourcePath}`,
    );
  }
  return runInNewContext(servedSource, context, {
    filename: resolve(repositoryRoot, sourcePath),
  });
}
