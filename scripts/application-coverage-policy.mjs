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
  "test/review-validation.test.js",
  "test/review-schema-migration.test.js",
  "test/review-version-change-detection.test.js",
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
