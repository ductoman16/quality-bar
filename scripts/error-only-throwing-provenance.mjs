import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { parse } = /** @type {{
 *   parse: (
 *     source: string,
 *     options: {ecmaVersion: "latest", sourceType: "module"},
 *   ) => import("estree").Program,
 * }} */ (createRequire(import.meta.url)("espree"));

const repositoryRoot = resolve(import.meta.dirname, "..");
const repositoryConstructors = new Map(
  Object.entries({
    "src/browser-assets.js": ["BrowserAssetError"],
    "src/browser-session.js": ["BrowserSessionError"],
    "src/codex-capabilities.js": ["CodexConfigurationError"],
    "src/durable-error.js": ["DurableCoreError"],
    "src/execution-analytics.js": ["AnalyticsError"],
    "src/github-connection-error.js": ["GitHubConnectionError"],
    "src/implementer-token.js": ["ImplementerTokenError"],
    "src/installation-configuration.js": ["InstallationConfigurationError"],
    "src/installation-environment.js": ["InstallationEnvironmentError"],
    "src/operator-login-throttle.js": ["OperatorLoginThrottleError"],
    "src/operator-password.js": ["OperatorPasswordError"],
    "src/request-security.js": ["RequestSecurityError"],
    "src/review-run-checkout.js": ["ReviewRunCheckoutError"],
    "src/review-run-result.js": ["ReviewRunExecutionError"],
    "src/review-validation.js": ["ReviewError"],
    "src/storage-reserve.js": ["StorageReserveError"],
  }).map(([path, names]) => [resolve(repositoryRoot, path), new Set(names)]),
);

const validatedRepositoryReexports = new Map([
  [
    resolve(repositoryRoot, "src/durable-core.js"),
    new Map([["DurableCoreError", "./durable-error.js"]]),
  ],
  [
    resolve(repositoryRoot, "src/github-connection.js"),
    new Map([["GitHubConnectionError", "./github-connection-error.js"]]),
  ],
]);

/** @param {string} path @param {string} name */
export function isValidatedRepositoryConstructor(path, name) {
  if (repositoryConstructors.get(path)?.has(name)) {
    return true;
  }
  const reexportSource = validatedRepositoryReexports.get(path)?.get(name);
  if (reexportSource === undefined) {
    return false;
  }
  const program = parse(readFileSync(path, "utf8"), {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  return (
    program.body.some(
      (statement) =>
        statement.type === "ExportNamedDeclaration" &&
        statement.source?.value === reexportSource &&
        statement.specifiers.some(
          (specifier) =>
            specifier.type === "ExportSpecifier" &&
            specifier.local.type === "Identifier" &&
            specifier.exported.type === "Identifier" &&
            specifier.local.name === name &&
            specifier.exported.name === name,
        ),
    ) &&
    (repositoryConstructors
      .get(resolve(dirname(path), reexportSource))
      ?.has(name) ??
      false)
  );
}
