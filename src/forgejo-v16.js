import { verifyRepositoryRead } from "./repository-git.js";
import {
  beginForgejoCapabilityEvidence,
  createForgejoVerificationEvidence,
  throwWithForgejoEvidence,
  VERIFIED_FORGEJO_AUTHORITIES,
} from "./forgejo-v16-evidence.js";
import {
  forgejoRepository as repository,
  forgejoRepositoryOwner as repositoryOwner,
  requireForgejoRepositoryAuthority as requiredRepositoryAuthority,
} from "./forgejo-v16-repository.js";
import { createForgejoV16PullRequestReader } from "./forgejo-v16-polling.js";

const PROFILE = "forgejo-v16";
const REQUIRED_OPENAPI_OPERATIONS = Object.freeze([
  ["/repos/search", "get", "200"],
  ["/repos/{owner}/{repo}", "get", "200"],
  ["/repos/{owner}/{repo}/branches", "get", "200"],
  ["/repos/{owner}/{repo}/pulls", "get", "200"],
  ["/repos/{owner}/{repo}/issues/comments", "get", "200"],
  ["/repos/{owner}/{repo}/statuses/{sha}", "post", "201"],
  ["/repos/{owner}/{repo}/issues/{index}/comments", "post", "201"],
  ["/repos/{owner}/{repo}/pulls/{index}/reviews", "post", "200"],
]);

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
function fail(code, message, cause) {
  throw Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value @param {string} message */
function string(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    fail("forgejo_api_response_invalid", message);
  }
  return value;
}

/** @param {unknown} value */
function version(value) {
  const reported = string(
    object(value)?.version,
    "Forgejo version response is invalid",
  );
  if (!/^16\.\d+\.\d+(?:\+gitea-\d+\.\d+\.\d+)?$/.test(reported)) {
    fail(
      "forgejo_version_unsupported",
      "Forgejo Connection requires stable v16.x",
    );
  }
  return reported;
}

/** @param {unknown} value */
function openApi(value) {
  const document = object(value);
  const paths = object(document?.paths);
  if (document?.swagger !== "2.0" || !paths) {
    fail("forgejo_openapi_invalid", "Forgejo v16 OpenAPI evidence is invalid");
  }
  for (const [path, method, successStatus] of REQUIRED_OPENAPI_OPERATIONS) {
    const operation = object(object(paths[path])?.[method]);
    const responses = object(operation?.responses);
    if (!operation || !object(responses?.[successStatus])) {
      fail(
        "forgejo_openapi_invalid",
        `Forgejo v16 OpenAPI evidence is missing required operation: ${method} ${path}`,
      );
    }
  }
}

/** @param {unknown} value @param {string} route @param {string} field */
function routeArray(value, route, field) {
  if (
    !Array.isArray(value) ||
    value.some((candidate) => {
      const record = object(candidate);
      return (
        !record ||
        (typeof record[field] !== "string" &&
          !Number.isSafeInteger(record[field]))
      );
    })
  ) {
    fail(
      "forgejo_required_route_invalid",
      `Forgejo required route response is invalid: ${route}`,
    );
  }
}

/** @param {string} baseUrl */
export function normalizedForgejoBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail("forgejo_url_invalid", "Forgejo URL is invalid");
  }
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail("forgejo_url_invalid", "Forgejo URL is invalid");
  }
  return url.toString().replace(/\/$/, "");
}

/** @param {string} path @param {Response} response */
async function responseJson(path, response) {
  if (!response.ok) {
    fail(
      "forgejo_required_route_unavailable",
      `Forgejo required route is unavailable: ${path}`,
    );
  }
  try {
    return await response.json();
  } catch {
    fail(
      "forgejo_api_response_invalid",
      `Forgejo response is invalid: ${path}`,
    );
  }
}

/** @param {{fetch?: typeof fetch, now?: () => number, verifyGit?: typeof verifyRepositoryRead}} [options] */
export function createForgejoV16Verifier({
  fetch: fetchRequest = fetch,
  now = () => Date.now(),
  verifyGit = verifyRepositoryRead,
} = {}) {
  if (
    typeof fetchRequest !== "function" ||
    typeof now !== "function" ||
    typeof verifyGit !== "function"
  ) {
    throw new TypeError("Forgejo verifier dependencies are invalid");
  }
  const listPullRequests = createForgejoV16PullRequestReader({
    fetchRequest,
    normalizeBaseUrl: normalizedForgejoBaseUrl,
    now,
  });
  return {
    listPullRequests,
    /** @param {{baseUrl: string, repositoryIds?: number[], token: string}} input */
    async verify({ baseUrl, repositoryIds, token }) {
      if (
        (repositoryIds !== undefined &&
          (!Array.isArray(repositoryIds) ||
            new Set(repositoryIds).size !== repositoryIds.length ||
            repositoryIds.some(
              (id) => !Number.isSafeInteger(id) || id <= 0,
            ))) ||
        typeof token !== "string" ||
        token.length === 0
      ) {
        fail(
          "forgejo_verification_request_invalid",
          "Forgejo verification request is invalid",
        );
      }
      const origin = normalizedForgejoBaseUrl(baseUrl);
      const verificationEvidence =
        createForgejoVerificationEvidence(repositoryIds);
      /** @param {string} path */
      const get = async (path) => {
        let response;
        try {
          response = await fetchRequest(`${origin}${path}`, {
            headers: {
              accept: "application/json",
              authorization: `token ${token}`,
            },
            redirect: "error",
          });
        } catch (cause) {
          fail(
            "forgejo_api_unavailable",
            `Forgejo required route is unavailable: ${path}`,
            cause,
          );
        }
        return { body: await responseJson(path, response) };
      };
      try {
        verificationEvidence.reported_version = version(
          (await get("/api/v1/version")).body,
        );
        openApi((await get("/swagger.v1.json")).body);
        beginForgejoCapabilityEvidence(verificationEvidence);
      } catch (error) {
        throwWithForgejoEvidence(error, verificationEvidence);
      }
      const capabilityEvidence = verificationEvidence.capabilities;
      if (!capabilityEvidence) {
        throw new TypeError("Forgejo capability evidence is invalid");
      }
      /** @type {ReturnType<typeof repository>[]} */
      const enumerated = [];
      const enumeratedIds = new Set();
      /** @type {{id: number, login: string} | undefined} */
      let verifiedPrincipal;
      for (let page = 1; ; page += 1) {
        try {
          const repositoriesResponse = await get(
            `/api/v1/repos/search?page=${page}&limit=50&private=true`,
          );
          const search = object(repositoriesResponse.body);
          if (search?.ok !== true || !Array.isArray(search.data)) {
            fail(
              "forgejo_repository_enumeration_incomplete",
              "Forgejo Repository enumeration is invalid",
            );
          }
          if (page === 1 && search.data.length === 0) {
            fail(
              "forgejo_repository_enumeration_incomplete",
              "Forgejo Repository enumeration is empty",
            );
          }
          const pagePrincipals = search.data.map(repositoryOwner);
          const pageRepositories = search.data.map(repository);
          for (const candidate of pagePrincipals) {
            if (
              verifiedPrincipal &&
              (candidate.id !== verifiedPrincipal.id ||
                candidate.login !== verifiedPrincipal.login)
            ) {
              fail(
                "forgejo_principal_invalid",
                "Forgejo Repository enumeration spans multiple principals",
              );
            }
            verifiedPrincipal = candidate;
            verificationEvidence.principal = candidate;
          }
          if (pageRepositories.some(({ id }) => enumeratedIds.has(id))) {
            fail(
              "forgejo_repository_enumeration_incomplete",
              "Forgejo Repository enumeration contains duplicate identities",
            );
          }
          pageRepositories.forEach(({ id }) => enumeratedIds.add(id));
          enumerated.push(...pageRepositories);
          if (pageRepositories.length < 50) {
            capabilityEvidence.enumeration = "verified";
            break;
          }
        } catch (error) {
          capabilityEvidence.enumeration = "error";
          throwWithForgejoEvidence(error, verificationEvidence);
        }
      }
      if (repositoryIds === undefined) {
        return { repositories: enumerated };
      }
      if (!verifiedPrincipal) {
        fail(
          "forgejo_principal_invalid",
          "Forgejo principal response is invalid",
        );
      }
      const selected = repositoryIds.map((id) =>
        enumerated.find((candidate) => candidate.id === id),
      );
      if (selected.some((candidate) => !candidate)) {
        const missingRepositoryIds = selected.flatMap((candidate, index) =>
          candidate ? [] : [repositoryIds[index]],
        );
        try {
          throw Object.assign(
            new Error(
              "Selected Forgejo Repository is not accessible to the Connection",
            ),
            {
              code: "forgejo_repository_selection_unavailable",
              repositoryId:
                missingRepositoryIds.length === 1
                  ? missingRepositoryIds[0]
                  : undefined,
            },
          );
        } catch (error) {
          throwWithForgejoEvidence(error, verificationEvidence);
        }
      }
      /** @type {any[]} */
      const repositoryChecks = selected.map((candidate) => ({
        forge_repository_id: candidate?.id,
        outcome: "not_completed",
        permissions: candidate?.permissions,
      }));
      verificationEvidence.repositories = repositoryChecks;
      for (const [index, selectedCandidate] of selected.entries()) {
        const selectedRepository =
          /** @type {NonNullable<typeof selectedCandidate>} */ (
            selectedCandidate
          );
        /** @type {string[]} */
        let activeCapabilities = [];
        try {
          const name = selectedRepository.full_name;
          const encoded = name.split("/").map(encodeURIComponent).join("/");
          activeCapabilities = [
            "aggregate_feedback",
            "commit_status",
            "inline_feedback",
          ];
          requiredRepositoryAuthority(
            (await get(`/api/v1/repos/${encoded}`)).body,
            selectedRepository.id,
          );
          if (index === selected.length - 1) {
            capabilityEvidence.commit_status = "verified";
            capabilityEvidence.inline_feedback = "verified";
          }
          activeCapabilities = ["branch_access"];
          routeArray(
            (await get(`/api/v1/repos/${encoded}/branches`)).body,
            "branches",
            "name",
          );
          if (index === selected.length - 1) {
            capabilityEvidence.branch_access = "verified";
          }
          activeCapabilities = ["pull_request_access"];
          routeArray(
            (await get(`/api/v1/repos/${encoded}/pulls?state=open`)).body,
            "pull requests",
            "number",
          );
          if (index === selected.length - 1) {
            capabilityEvidence.pull_request_access = "verified";
          }
          activeCapabilities = ["aggregate_feedback"];
          routeArray(
            (await get(`/api/v1/repos/${encoded}/issues/comments`)).body,
            "issue comments",
            "id",
          );
          if (index === selected.length - 1) {
            capabilityEvidence.aggregate_feedback = "verified";
          }
          activeCapabilities = ["private_git_read"];
          await verifyGit(
            selectedRepository.clone_url,
            { token, username: "oauth2" },
            { definitiveHttpStatuses: [401, 403, 404], followRedirects: false },
          );
          if (index === selected.length - 1) {
            capabilityEvidence.private_git_read = "verified";
          }
          repositoryChecks[index] = {
            ...selectedRepository,
            outcome: "success",
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          for (const capability of activeCapabilities) {
            capabilityEvidence[capability] = "error";
          }
          repositoryChecks[index] = {
            error: { code: error.code, message: error.message },
            forge_repository_id: selectedRepository.id,
            outcome: "error",
            permissions: selectedRepository.permissions,
          };
          throwWithForgejoEvidence(error, verificationEvidence);
        }
      }
      if (selected.length === 0) {
        verificationEvidence.repositories = [];
      }
      return {
        capabilities: capabilityEvidence,
        principal: verifiedPrincipal,
        profile: PROFILE,
        reported_version: verificationEvidence.reported_version,
        repositories: repositoryChecks,
        scopes: [...VERIFIED_FORGEJO_AUTHORITIES],
      };
    },
  };
}
