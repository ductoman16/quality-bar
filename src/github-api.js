import { sign } from "node:crypto";

import {
  GITHUB_REQUIRED_PERMISSIONS,
  GITHUB_VERIFIED_CAPABILITIES,
} from "./github-app-manifest.js";
import { createGitHubApiRequest } from "./github-api-request.js";
import { GitHubConnectionError } from "./github-connection-error.js";
import * as gitVerification from "./github-git-verification.js";
import { verifyGitHubRepositories } from "./github-repository-verification.js";
import { createGitHubPullRequestReader } from "./github-pull-request-api.js";
import { createGitHubInstallationToken } from "./github-installation-token.js";
import { createGitHubCommitStatusPublisher } from "./github-commit-status-api.js";
import { createGitHubManifestExchange } from "./github-manifest-exchange.js";
import { verifyRepositoryRead } from "./repository-git.js";

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
function fail(code, message, cause) {
  throw new GitHubConnectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** @param {unknown} value */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value @returns {{id: number, login: string, type: "User"}} */
function principal(value) {
  const candidate = object(value);
  if (
    !candidate ||
    !Number.isSafeInteger(candidate.id) ||
    typeof candidate.login !== "string" ||
    candidate.login.length === 0 ||
    candidate.type !== "User"
  ) {
    fail(
      "github_personal_account_required",
      "GitHub Connection requires one personal account",
    );
  }
  return {
    id: /** @type {number} */ (candidate.id),
    login: candidate.login,
    type: /** @type {"User"} */ (candidate.type),
  };
}

/** @param {unknown} value */
function exactPermissions(value) {
  const candidate = object(value);
  const expected = Object.entries(GITHUB_REQUIRED_PERMISSIONS);
  if (
    !candidate ||
    Object.keys(candidate).length !== expected.length ||
    expected.some(([name, permission]) => candidate[name] !== permission)
  ) {
    fail(
      "github_permissions_mismatch",
      "GitHub App permissions do not match the required profile",
    );
  }
}

/** @param {unknown} value @param {string} message @returns {string} */
function nonemptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    fail("github_api_response_invalid", message);
  }
  return value;
}

/** @param {number} appId @param {string} pem @param {number} now */
function appJwt(appId, pem, now) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const seconds = Math.floor(now / 1_000);
  const payload = Buffer.from(
    JSON.stringify({ exp: seconds + 540, iat: seconds - 60, iss: appId }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  try {
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), pem).toString(
      "base64url",
    )}`;
  } catch (cause) {
    fail(
      "github_connection_credential_invalid",
      "GitHub App private key is invalid",
      cause,
    );
  }
}

/** @param {{apiBaseUrl?: string, fetch?: typeof fetch, now?: () => number, verifyGit?: typeof verifyRepositoryRead}} [options] */
export function createGitHubVerifier({
  apiBaseUrl = "https://api.github.com",
  fetch: fetchRequest = fetch,
  now = () => Date.now(),
  verifyGit = verifyRepositoryRead,
} = {}) {
  if (
    typeof fetchRequest !== "function" ||
    typeof now !== "function" ||
    typeof verifyGit !== "function"
  ) {
    throw new TypeError("GitHub verifier dependencies are invalid");
  }

  const request = createGitHubApiRequest(apiBaseUrl, fetchRequest, now);

  const installationToken = createGitHubInstallationToken({
    appJwt,
    exactPermissions,
    fail,
    nonemptyString,
    now,
    object,
    request,
  });
  const publishCommitStatus = createGitHubCommitStatusPublisher({
    fail,
    installationToken,
    request,
  });
  const exchangeManifest = createGitHubManifestExchange({
    fail,
    nonemptyString,
    object,
    principal,
    request,
  });

  const verifier = {
    exchangeManifest,
    /**
     * @param {{
     *   app_id: number,
     *   app_slug: string,
     *   client_id: string | null,
     *   owner: {id: number, login: string, type: "User"},
     *   pem: string
     * }} credential
     * @param {number} installationId
     * @param {number[] | undefined} [repositoryIds]
     */
    async verifyInstallation(credential, installationId, repositoryIds) {
      const jwt = appJwt(credential.app_id, credential.pem, now());
      const app = object(await request("/app", { authorization: jwt }));
      if (
        !app ||
        app.id !== credential.app_id ||
        app.slug !== credential.app_slug ||
        (credential.client_id !== null &&
          app.client_id !== credential.client_id) ||
        app.public !== false ||
        !Array.isArray(app.events) ||
        app.events.length !== 0
      ) {
        fail(
          "github_app_profile_mismatch",
          "GitHub App does not match the required private webhook-free profile",
        );
      }
      const appOwner = principal(app.owner);
      if (
        appOwner.id !== credential.owner.id ||
        appOwner.login !== credential.owner.login
      ) {
        fail(
          "github_principal_mismatch",
          "GitHub App principal does not match the manifest owner",
        );
      }
      exactPermissions(app.permissions);

      const installations = await request("/app/installations?per_page=100", {
        authorization: jwt,
      });
      if (!Array.isArray(installations)) {
        fail(
          "github_api_response_invalid",
          "GitHub installation response is invalid",
        );
      }
      if (installations.length !== 1) {
        fail(
          "github_installation_scope_invalid",
          "GitHub App must have exactly one personal-account installation",
        );
      }
      const installation = object(
        installations.find(
          /** @param {unknown} candidate */ (candidate) =>
            object(candidate)?.id === installationId,
        ),
      );
      if (
        !installation ||
        installation.app_id !== credential.app_id ||
        installation.target_type !== "User" ||
        installation.suspended_at !== null ||
        !Array.isArray(installation.events) ||
        installation.events.length !== 0
      ) {
        fail(
          "github_installation_mismatch",
          "GitHub App installation does not match the required personal profile",
        );
      }
      const installationPrincipal = principal(installation.account);
      if (
        installationPrincipal.id !== appOwner.id ||
        installationPrincipal.login !== appOwner.login
      ) {
        fail(
          "github_principal_mismatch",
          "GitHub installation principal does not match the App owner",
        );
      }
      exactPermissions(installation.permissions);

      const token = await installationToken(credential, installationId);

      /** @type {{
       *   api_url: string,
       *   clone_url: string,
       *   full_name: string,
       *   html_url: string,
       *   id: number,
       *   private: boolean
       * }[]} */
      const repositories = [];
      const repositoryIdsSeen = new Set();
      for (let page = 1; ; page += 1) {
        const collection = object(
          await request(
            `/installation/repositories?per_page=100&page=${page}`,
            { authorization: token },
          ),
        );
        if (!collection || !Array.isArray(collection.repositories)) {
          fail(
            "github_api_response_invalid",
            "GitHub Repository enumeration response is invalid",
          );
        }
        const repositoryPage = collection.repositories;
        for (const value of repositoryPage) {
          const repository = object(value);
          const owner = principal(repository?.owner);
          const fullName = nonemptyString(
            repository?.full_name,
            "GitHub Repository identity is invalid",
          );
          const cloneUrl = nonemptyString(
            repository?.clone_url,
            "GitHub Repository identity is invalid",
          );
          const apiUrl = nonemptyString(
            repository?.url,
            "GitHub Repository identity is invalid",
          );
          const htmlUrl = nonemptyString(
            repository?.html_url,
            "GitHub Repository identity is invalid",
          );
          const evidence = {
            api_url: apiUrl,
            clone_url: cloneUrl,
            full_name: fullName,
            html_url: htmlUrl,
            id: /** @type {number} */ (repository?.id),
            private: /** @type {boolean} */ (repository?.private),
          };
          if (
            !repository ||
            !gitVerification.validGitHubRepositoryEvidence(
              evidence,
              installationPrincipal.login,
            ) ||
            repositoryIdsSeen.has(evidence.id) ||
            owner.id !== installationPrincipal.id ||
            owner.login !== installationPrincipal.login
          ) {
            fail(
              "github_repository_identity_invalid",
              "GitHub Repository identity is invalid or outside the personal account",
            );
          }
          repositoryIdsSeen.add(evidence.id);
          repositories.push(evidence);
        }
        if (repositoryPage.length < 100) {
          if (
            collection.total_count !== repositories.length ||
            repositories.length === 0
          ) {
            fail(
              "github_repository_enumeration_incomplete",
              "GitHub Repository enumeration is empty or incomplete",
            );
          }
          break;
        }
      }
      const selectedRepositories =
        repositoryIds === undefined
          ? repositories
          : repositories.filter((repository) =>
              repositoryIds.includes(repository.id),
            );
      if (
        repositoryIds !== undefined &&
        (selectedRepositories.length !== repositoryIds.length ||
          new Set(selectedRepositories.map(({ id }) => id)).size !==
            repositoryIds.length)
      ) {
        const repositoryId = repositoryIds.find(
          (id) =>
            !selectedRepositories.some((repository) => repository.id === id),
        );
        gitVerification.failGitHubRepositoryVerification(
          "github_repository_selection_unavailable",
          "Selected GitHub Repository is not accessible to the Connection",
          repositoryIds,
          repositories,
          repositoryId,
        );
      }
      const privateRepository = repositories.find(
        (repository) => repository.private,
      );
      if (!privateRepository) {
        gitVerification.failGitHubRepositoryVerification(
          "github_private_repository_required",
          "GitHub Connection must prove private Repository read access",
          repositoryIds,
          repositories,
        );
      }
      const repositoriesToVerify =
        repositoryIds === undefined ||
        selectedRepositories.some((repository) => repository.private)
          ? selectedRepositories
          : [...selectedRepositories, privateRepository];
      const affectedRepositoryIds = repositoriesToVerify.map(({ id }) => id);
      const completedRepositoryIds = [];
      for (const repository of repositoriesToVerify) {
        try {
          const repositoryPath = `/repos/${repository.full_name}`;
          await request(`${repositoryPath}/pulls?per_page=1&state=all`, {
            authorization: token,
            affectedRepositoryIds,
            repositoryId: repository.id,
          });
          await request(`${repositoryPath}/branches?per_page=1`, {
            authorization: token,
            affectedRepositoryIds,
            repositoryId: repository.id,
          });
          await request(`${repositoryPath}/issues?per_page=1&state=all`, {
            authorization: token,
            affectedRepositoryIds,
            repositoryId: repository.id,
          });
          await gitVerification.verifyGitHubRepositoryRead(
            verifyGit,
            repository,
            token,
            affectedRepositoryIds,
          );
          completedRepositoryIds.push(repository.id);
        } catch (error) {
          if (error instanceof GitHubConnectionError) {
            throw new GitHubConnectionError(error.code, error.message, {
              affectedRepositoryIds: error.affectedRepositoryIds,
              cause: error,
              completedRepositoryIds,
              repositoryEvidence: repositories,
              repositoryId: error.repositoryId,
            });
          }
          throw error;
        }
      }
      return {
        capabilities: GITHUB_VERIFIED_CAPABILITIES,
        principal: installationPrincipal,
        repositories: repositoriesToVerify,
        ...(repositoryIds === undefined
          ? {}
          : { repositoryEvidence: repositories }),
      };
    },
    /**
     * @param {{
     *   app_id: number,
     *   app_slug: string,
     *   client_id: string,
     *   owner: {id: number, login: string, type: "User"},
     *   pem: string
     * }} credential
     * @param {number} installationId
     * @param {number[]} repositoryIds
     */
    async verifyRepositories(credential, installationId, repositoryIds) {
      return verifyGitHubRepositories(
        verifier.verifyInstallation,
        credential,
        installationId,
        repositoryIds,
      );
    },
    createInstallationToken: installationToken,
    publishCommitStatus,
    listPullRequests: createGitHubPullRequestReader({
      installationToken,
      request,
    }),
  };
  return verifier;
}
