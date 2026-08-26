import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function configurationFailure(code: string, detail: string) {
  return Object.assign(new Error(detail), { code });
}

function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function readPrivateGitHubCanaryConfiguration(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
) {
  const configuredPath = environment.QUALITY_BAR_PRIVATE_GITHUB_CANARY_CONFIG;
  if (typeof configuredPath !== "string" || !isAbsolute(configuredPath)) {
    throw configurationFailure(
      "private_github_canary_configuration_missing",
      "QUALITY_BAR_PRIVATE_GITHUB_CANARY_CONFIG must be an absolute path",
    );
  }
  let configuration;
  try {
    configuration = JSON.parse(readFileSync(configuredPath, "utf8"));
  } catch (cause) {
    throw configurationFailure(
      "private_github_canary_configuration_invalid",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const pemPath = configuration?.credential?.pem_path;
  if (typeof pemPath !== "string" || !isAbsolute(pemPath)) {
    throw configurationFailure(
      "private_github_canary_credential_path_invalid",
      "GitHub App private key path must be absolute",
    );
  }
  let realRepositoryRoot;
  let realPemPath;
  let pemStat;
  try {
    realRepositoryRoot = realpathSync(repositoryRoot);
    realPemPath = realpathSync(pemPath);
    pemStat = lstatSync(realPemPath);
  } catch (cause) {
    throw configurationFailure(
      "private_github_canary_credential_unavailable",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (
    inside(realRepositoryRoot, realPemPath) ||
    !pemStat.isFile() ||
    (pemStat.mode & 0o077) !== 0
  ) {
    throw configurationFailure(
      "private_github_canary_credential_path_invalid",
      "GitHub App private key must be a private regular file outside the checkout",
    );
  }
  const credential = configuration.credential;
  if (
    !Number.isSafeInteger(credential.app_id) ||
    credential.app_id <= 0 ||
    typeof credential.app_slug !== "string" ||
    credential.app_slug.length === 0 ||
    (typeof credential.client_id !== "string" &&
      credential.client_id !== null) ||
    (credential.client_id !== null && credential.client_id.length === 0) ||
    !Number.isSafeInteger(credential.owner?.id) ||
    credential.owner.id <= 0 ||
    typeof credential.owner?.login !== "string" ||
    credential.owner.login.length === 0 ||
    credential.owner.type !== "User"
  ) {
    throw configurationFailure(
      "private_github_canary_configuration_invalid",
      "GitHub App credential identity is invalid",
    );
  }
  return {
    credential: {
      app_id: credential.app_id,
      app_slug: credential.app_slug,
      client_id: credential.client_id,
      owner: credential.owner,
      pem: readFileSync(realPemPath, "utf8"),
    },
    fixture: configuration.fixture,
    configurationPath: resolve(configuredPath),
  };
}
