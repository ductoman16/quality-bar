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
