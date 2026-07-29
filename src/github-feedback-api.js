/** @param {unknown} value */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {{full_name: string, id: number}} repository */
function validRepository(repository) {
  return (
    Number.isSafeInteger(repository?.id) &&
    repository.id > 0 &&
    typeof repository.full_name === "string" &&
    /^[^/]+\/[^/]+$/.test(repository.full_name)
  );
}

/**
 * @param {{
 *   fail: (code: string, message: string) => never,
 *   installationToken: (credential: any, installationId: number) => Promise<string>,
 *   request: (path: string, options: any) => Promise<unknown>
 * }} dependencies
 */
export function createGitHubFeedbackPublisher(dependencies) {
  /** @param {{full_name: string}} repository @param {number} pullRequestNumber @param {string} collection */
  function path(repository, pullRequestNumber, collection) {
    const fullName = repository.full_name
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `/repos/${fullName}/${collection}/${pullRequestNumber}/comments`;
  }

  /**
   * @param {any} credential
   * @param {number} installationId
   * @param {{full_name: string, id: number}} repository
   * @param {number} pullRequestNumber
   * @param {string} body
   */
  async function publishAggregate(
    credential,
    installationId,
    repository,
    pullRequestNumber,
    body,
  ) {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !validRepository(repository) ||
      !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber <= 0 ||
      typeof body !== "string" ||
      body.length === 0
    ) {
      throw new TypeError("GitHub aggregate feedback input is invalid");
    }
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    const response = object(
      await dependencies.request(
        path(repository, pullRequestNumber, "issues"),
        {
          affectedRepositoryIds: [repository.id],
          authorization,
          body: { body },
          method: "POST",
          repositoryId: repository.id,
        },
      ),
    );
    if (
      !response ||
      !Number.isSafeInteger(response.id) ||
      response.body !== body
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub aggregate feedback response is invalid",
      );
    }
    return /** @type {number} */ (response.id);
  }

  /**
   * @param {any} credential
   * @param {number} installationId
   * @param {{full_name: string, id: number}} repository
   * @param {number} pullRequestNumber
   * @param {{body: string, commit_id: string, line: number, path: string, side: "LEFT" | "RIGHT", start_line?: number, start_side?: "LEFT" | "RIGHT"}} comment
   */
  async function publishInline(
    credential,
    installationId,
    repository,
    pullRequestNumber,
    comment,
  ) {
    const startLine = comment?.start_line;
    const singleLine =
      startLine === undefined && comment?.start_side === undefined;
    const range =
      Number.isSafeInteger(startLine) &&
      /** @type {number} */ (startLine) > 0 &&
      /** @type {number} */ (startLine) <= comment.line &&
      comment.start_side === comment.side;
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !validRepository(repository) ||
      !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber <= 0 ||
      typeof comment?.body !== "string" ||
      comment.body.length === 0 ||
      typeof comment.commit_id !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(comment.commit_id) ||
      typeof comment.path !== "string" ||
      comment.path.length === 0 ||
      !["LEFT", "RIGHT"].includes(comment.side) ||
      !Number.isSafeInteger(comment.line) ||
      comment.line <= 0 ||
      !(singleLine || range)
    ) {
      throw new TypeError("GitHub inline feedback input is invalid");
    }
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    const response = object(
      await dependencies.request(path(repository, pullRequestNumber, "pulls"), {
        affectedRepositoryIds: [repository.id],
        authorization,
        body: comment,
        method: "POST",
        repositoryId: repository.id,
      }),
    );
    if (
      !response ||
      !Number.isSafeInteger(response.id) ||
      response.body !== comment.body ||
      response.commit_id !== comment.commit_id ||
      response.path !== comment.path ||
      response.line !== comment.line ||
      response.side !== comment.side ||
      (comment.start_line === undefined
        ? response.start_line !== null
        : response.start_line !== comment.start_line) ||
      (comment.start_side === undefined
        ? response.start_side !== null
        : response.start_side !== comment.start_side)
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub inline feedback response is invalid",
      );
    }
    return /** @type {number} */ (response.id);
  }

  return { publishAggregate, publishInline };
}
