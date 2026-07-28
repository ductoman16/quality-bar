import { verifyRepositoryRead } from "./repository-git.js";

const PROFILE = "forgejo-v16";
const VERIFIED_AUTHORITIES = Object.freeze([
  "read:repository",
  "write:issue",
  "write:repository",
]);
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
function principal(value) {
  const candidate = object(value);
  const id = candidate?.id;
  const login = candidate?.login;
  if (
    !candidate ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof login !== "string" ||
    login.length === 0
  ) {
    fail("forgejo_principal_invalid", "Forgejo principal response is invalid");
  }
  return { id, login };
}

/** @param {unknown} value */
function repositoryOwner(value) {
  return principal(object(value)?.owner);
}

/** @param {unknown} value */
function repository(value) {
  const candidate = object(value);
  const permissions = object(candidate?.permissions);
  const evidence = {
    api_url: candidate?.url,
    clone_url: candidate?.clone_url,
    full_name: candidate?.full_name,
    html_url: candidate?.html_url,
    id: candidate?.id,
    private: candidate?.private,
  };
  if (
    !candidate ||
    typeof evidence.id !== "number" ||
    !Number.isSafeInteger(evidence.id) ||
    evidence.id <= 0 ||
    !Object.values(evidence).every(
      (field) =>
        field !== undefined &&
        (typeof field === "string" ? field.length > 0 : true),
    ) ||
    typeof evidence.private !== "boolean" ||
    !permissions ||
    permissions.pull !== true ||
    permissions.push !== true ||
    permissions.admin !== true
  ) {
    fail(
      "forgejo_repository_capability_missing",
      "Forgejo Repository does not have the required v16 authority",
    );
  }
  return /** @type {{api_url: string, clone_url: string, full_name: string, html_url: string, id: number, private: boolean}} */ (
    evidence
  );
}

/** @param {unknown} value @param {number} expectedId */
function requiredRepositoryAuthority(value, expectedId) {
  const candidate = object(value);
  const permissions = object(candidate?.permissions);
  if (
    !candidate ||
    candidate.id !== expectedId ||
    !permissions ||
    permissions.pull !== true ||
    permissions.push !== true ||
    permissions.admin !== true
  ) {
    fail(
      "forgejo_repository_capability_missing",
      "Forgejo Repository does not have the required v16 authority",
    );
  }
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
function endpoint(baseUrl) {
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

/** @param {{fetch?: typeof fetch, verifyGit?: typeof verifyRepositoryRead}} [options] */
export function createForgejoV16Verifier({
  fetch: fetchRequest = fetch,
  verifyGit = verifyRepositoryRead,
} = {}) {
  if (typeof fetchRequest !== "function" || typeof verifyGit !== "function") {
    throw new TypeError("Forgejo verifier dependencies are invalid");
  }
  return {
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
      const origin = endpoint(baseUrl);
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
      const versionResponse = await get("/api/v1/version");
      const reportedVersion = version(versionResponse.body);
      openApi((await get("/swagger.v1.json")).body);
      /** @type {ReturnType<typeof repository>[]} */
      const enumerated = [];
      const enumeratedIds = new Set();
      /** @type {{id: number, login: string} | undefined} */
      let verifiedPrincipal;
      for (let page = 1; ; page += 1) {
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
          break;
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
        fail(
          "forgejo_repository_selection_unavailable",
          "Selected Forgejo Repository is not accessible to the Connection",
        );
      }
      /** @type {any[]} */
      const repositoryChecks = selected.map((candidate) => ({
        forge_repository_id: candidate?.id,
        outcome: "not_completed",
      }));
      for (const [index, selectedCandidate] of selected.entries()) {
        const selectedRepository =
          /** @type {NonNullable<typeof selectedCandidate>} */ (
            selectedCandidate
          );
        try {
          const name = selectedRepository.full_name;
          const encoded = name.split("/").map(encodeURIComponent).join("/");
          requiredRepositoryAuthority(
            (await get(`/api/v1/repos/${encoded}`)).body,
            selectedRepository.id,
          );
          const [branches, pulls, comments] = await Promise.all([
            get(`/api/v1/repos/${encoded}/branches`),
            get(`/api/v1/repos/${encoded}/pulls?state=open`),
            get(`/api/v1/repos/${encoded}/issues/comments`),
          ]);
          routeArray(branches.body, "branches", "name");
          routeArray(pulls.body, "pull requests", "number");
          routeArray(comments.body, "issue comments", "id");
          await verifyGit(
            selectedRepository.clone_url,
            { token, username: "oauth2" },
            { definitiveHttpStatuses: [401, 403, 404], followRedirects: false },
          );
          repositoryChecks[index] = {
            forge_repository_id: selectedRepository.id,
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
          repositoryChecks[index] = {
            error: { code: error.code, message: error.message },
            forge_repository_id: selectedRepository.id,
            outcome: "error",
          };
          throw Object.assign(error, {
            repositoryChecks,
            verificationEvidence: {
              capabilities: {
                aggregate_feedback: "not_completed",
                branch_access: "not_completed",
                commit_status: "not_completed",
                enumeration: "verified",
                inline_feedback: "not_completed",
                private_git_read: "not_completed",
                pull_request_access: "not_completed",
              },
              principal: verifiedPrincipal,
              profile: PROFILE,
              reported_version: reportedVersion,
              repositories: repositoryChecks,
              scopes: [...VERIFIED_AUTHORITIES],
            },
          });
        }
      }
      const repositoryCapabilities =
        selected.length === 0 ? "not_completed" : "verified";
      return {
        capabilities: {
          aggregate_feedback: repositoryCapabilities,
          branch_access: repositoryCapabilities,
          commit_status: repositoryCapabilities,
          enumeration: "verified",
          inline_feedback: repositoryCapabilities,
          private_git_read: repositoryCapabilities,
          pull_request_access: repositoryCapabilities,
        },
        principal: verifiedPrincipal,
        profile: PROFILE,
        reported_version: reportedVersion,
        repositories: selected.map((selectedRepository) => ({
          ...selectedRepository,
          outcome: "success",
        })),
        scopes: [...VERIFIED_AUTHORITIES],
      };
    },
  };
}
