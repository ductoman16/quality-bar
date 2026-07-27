import { sign } from "node:crypto";

import {
  GITHUB_REQUIRED_PERMISSIONS,
  GITHUB_VERIFIED_CAPABILITIES,
} from "./github-app-manifest.js";
import { GitHubConnectionError } from "./github-connection-error.js";
import { verifyRepositoryRead } from "./repository-git.js";

const API_VERSION = "2026-03-10";
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

  /** @param {string} path @param {{authorization?: string, method?: "GET" | "POST"}} [options] */
  async function request(path, { authorization, method = "GET" } = {}) {
    let response;
    try {
      response = await fetchRequest(new URL(path, apiBaseUrl), {
        headers: {
          accept: "application/vnd.github+json",
          ...(authorization
            ? { authorization: `Bearer ${authorization}` }
            : {}),
          "x-github-api-version": API_VERSION,
        },
        method,
        redirect: "error",
      });
    } catch (cause) {
      fail(
        "github_api_unavailable",
        "GitHub API request could not complete",
        cause,
      );
    }
    if (!response.ok) {
      fail(
        "github_api_request_failed",
        `GitHub API request failed with HTTP ${response.status}`,
      );
    }
    try {
      return /** @type {unknown} */ (await response.json());
    } catch (cause) {
      fail(
        "github_api_response_invalid",
        "GitHub API response is invalid",
        cause,
      );
    }
  }

  const verifier = {
    /** @param {string} code */
    async exchangeManifest(code) {
      if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(code)) {
        fail(
          "github_manifest_callback_invalid",
          "GitHub App Manifest callback is invalid",
        );
      }
      const response = object(
        await request(
          `/app-manifests/${encodeURIComponent(code)}/conversions`,
          { method: "POST" },
        ),
      );
      if (!response || !Number.isSafeInteger(response.id)) {
        fail(
          "github_api_response_invalid",
          "GitHub App Manifest response is invalid",
        );
      }
      return {
        app_id: /** @type {number} */ (response.id),
        app_slug: nonemptyString(
          response.slug,
          "GitHub App Manifest response is invalid",
        ),
        client_id: nonemptyString(
          response.client_id,
          "GitHub App Manifest response is invalid",
        ),
        owner: principal(response.owner),
        pem: nonemptyString(
          response.pem,
          "GitHub App Manifest response is invalid",
        ),
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
     * @param {number[] | undefined} [repositoryIds]
     */
    async verifyInstallation(credential, installationId, repositoryIds) {
      const jwt = appJwt(credential.app_id, credential.pem, now());
      const app = object(await request("/app", { authorization: jwt }));
      if (
        !app ||
        app.id !== credential.app_id ||
        app.slug !== credential.app_slug ||
        app.client_id !== credential.client_id ||
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

      const tokenResponse = object(
        await request(`/app/installations/${installationId}/access_tokens`, {
          authorization: jwt,
          method: "POST",
        }),
      );
      if (!tokenResponse) {
        fail(
          "github_api_response_invalid",
          "GitHub installation token response is invalid",
        );
      }
      exactPermissions(tokenResponse.permissions);
      const token = nonemptyString(
        tokenResponse.token,
        "GitHub installation token response is invalid",
      );

      /** @type {{
       *   api_url: string,
       *   clone_url: string,
       *   full_name: string,
       *   html_url: string,
       *   id: number,
       *   private: boolean
       * }[]} */
      const repositories = [];
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
          if (
            !repository ||
            !Number.isSafeInteger(repository.id) ||
            fullName !==
              `${installationPrincipal.login}/${fullName.split("/")[1] ?? ""}` ||
            owner.id !== installationPrincipal.id ||
            owner.login !== installationPrincipal.login ||
            typeof repository.private !== "boolean" ||
            cloneUrl !== `https://github.com/${fullName}.git` ||
            apiUrl !== `https://api.github.com/repos/${fullName}` ||
            htmlUrl !== `https://github.com/${fullName}`
          ) {
            fail(
              "github_repository_identity_invalid",
              "GitHub Repository identity is invalid or outside the personal account",
            );
          }
          repositories.push({
            api_url: apiUrl,
            clone_url: cloneUrl,
            full_name: fullName,
            html_url: htmlUrl,
            id: /** @type {number} */ (repository.id),
            private: /** @type {boolean} */ (repository.private),
          });
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
      const repositoriesToVerify =
        repositoryIds === undefined
          ? repositories
          : repositories.filter((repository) =>
              repositoryIds.includes(repository.id),
            );
      if (
        repositoryIds !== undefined &&
        repositoriesToVerify.length !== repositoryIds.length
      ) {
        fail(
          "github_repository_selection_unavailable",
          "Selected GitHub Repository is not accessible to the Connection",
        );
      }
      if (
        repositoryIds === undefined &&
        !repositories.some((repository) => repository.private)
      ) {
        fail(
          "github_private_repository_required",
          "GitHub Connection must prove private Repository read access",
        );
      }
      for (const repository of repositoriesToVerify) {
        const repositoryPath = `/repos/${repository.full_name}`;
        await request(`${repositoryPath}/pulls?per_page=1&state=all`, {
          authorization: token,
        });
        await request(`${repositoryPath}/branches?per_page=1`, {
          authorization: token,
        });
        await request(`${repositoryPath}/issues?per_page=1&state=all`, {
          authorization: token,
        });
        try {
          await verifyGit(
            repository.clone_url,
            { token, username: "x-access-token" },
            { followRedirects: false },
          );
        } catch (cause) {
          fail(
            "github_private_git_read_failed",
            "GitHub private Repository read verification failed",
            cause,
          );
        }
      }
      return {
        capabilities: GITHUB_VERIFIED_CAPABILITIES,
        principal: installationPrincipal,
        repositories: repositoriesToVerify,
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
      const verification = await verifier.verifyInstallation(
        credential,
        installationId,
        repositoryIds,
      );
      return verification.repositories;
    },
  };
  return verifier;
}
