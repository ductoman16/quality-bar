export const capabilities = /** @type {any} */ ({
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
});

export const availableRepositories = [
  {
    api_url: "https://api.github.com/repos/operator/alpha",
    clone_url: "https://github.com/operator/alpha.git",
    full_name: "operator/alpha",
    html_url: "https://github.com/operator/alpha",
    id: 101,
    private: true,
  },
  {
    api_url: "https://api.github.com/repos/operator/beta",
    clone_url: "https://github.com/operator/beta.git",
    full_name: "operator/beta",
    html_url: "https://github.com/operator/beta",
    id: 202,
    private: false,
  },
];
export const removedRepositoryState = {
  health: "error",
  health_error_code: "github_repository_selection_unavailable",
};

/** @param {{run(sql: string): unknown}} core */
export function markPrivateRepositoryUnhealthy(core) {
  core.run(
    `UPDATE repositories
     SET health = 'error',
         health_error_code = 'github_repository_git_read_failed',
         health_error_message = 'GitHub Repository Git read verification failed'
     WHERE id = 'repository-alpha'`,
  );
}

export function renamePrivateRepository() {
  availableRepositories[0] = {
    ...availableRepositories[0],
    clone_url: "https://github.com/operator/alpha-renamed.git",
    full_name: "operator/alpha-renamed",
    html_url: "https://github.com/operator/alpha-renamed",
    api_url: "https://api.github.com/repos/operator/alpha-renamed",
  };
}

/** @param {{get(sql: string): unknown}} core */
export function readPrivateRepositoryState(core) {
  return core.get(
    `SELECT normalized_url, verified_at, health, name
     FROM repositories
     JOIN github_repositories ON repository_id = repositories.id
     WHERE repositories.id = 'repository-alpha'`,
  );
}

/** @param {{get(sql: string): unknown}} core */
export function readRemovedRepositoryState(core) {
  return core.get(
    `SELECT health, health_error_code
     FROM repositories
     WHERE id = 'repository-beta'`,
  );
}
