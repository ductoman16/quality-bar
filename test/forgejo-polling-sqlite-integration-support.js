/** @param {number} id @param {string} name */
export function repositoryEvidence(id, name) {
  return {
    api_url: `https://forgejo.example/api/v1/repos/operator/${name}`,
    clone_url: `https://forgejo.example/operator/${name}.git`,
    full_name: `operator/${name}`,
    html_url: `https://forgejo.example/operator/${name}`,
    id,
    outcome: "success",
    permissions: { admin: true, pull: true, push: true },
    private: true,
  };
}

/** @param {number} number @param {Partial<{draft: boolean, head: {sha: string}}>} [overrides] */
export function pullRequest(number, overrides = {}) {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merge_base: number.toString(16).padStart(40, "c"),
    merged: false,
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

/** @param {any[]} repositories */
export function forgejoVerification(repositories) {
  return {
    capabilities: {
      aggregate_feedback: "verified",
      branch_access: "verified",
      commit_status: "verified",
      enumeration: "verified",
      inline_feedback: "verified",
      private_git_read: "verified",
      pull_request_access: "verified",
    },
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories,
    scopes: ["read:repository", "write:issue", "write:repository"],
  };
}

/** @param {any} core @param {string} fields */
export function enabledRepositoryPoll(core, fields) {
  return core.get(
    `SELECT ${fields}
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       JOIN forgejo_repository_polls
         ON forgejo_repository_polls.connection_id =
              forgejo_repositories.connection_id
        AND forgejo_repository_polls.forge_repository_id =
              forgejo_repositories.forge_repository_id`,
  );
}

/** @param {number[]} repositoryIds @param {number} failedRepositoryId */
export function createOneShotForgejoBaselineFailure(
  repositoryIds,
  failedRepositoryId,
) {
  let corrected = false;
  let position = 0;
  return {
    correct() {
      corrected = true;
    },
    /** @param {number} repositoryId @param {string} baseUrl */
    fails(repositoryId, baseUrl) {
      if (baseUrl !== "https://forgejo.example") {
        throw new Error("Forgejo baseline used the wrong Connection");
      }
      if (!corrected) {
        if (repositoryIds[position] !== repositoryId) {
          throw new Error("Forgejo baseline repeated a Repository");
        }
        position += 1;
      }
      return !corrected && repositoryId === failedRepositoryId;
    },
  };
}
