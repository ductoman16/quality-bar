import { githubFeedbackSourceIdentity as sourceIdentity } from "./github-feedback-identity.js";

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
   * @param {"issues" | "pulls"} collection
   * @param {(item: any) => boolean} matches
   */
  async function reconcile(
    credential,
    installationId,
    repository,
    pullRequestNumber,
    collection,
    matches,
  ) {
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    /** @type {number[]} */
    const identities = [];
    for (let page = 1; ; page += 1) {
      const response = await dependencies.request(
        `${path(repository, pullRequestNumber, collection)}?per_page=100&page=${page}`,
        {
          affectedRepositoryIds: [repository.id],
          authorization,
          repositoryId: repository.id,
        },
      );
      if (!Array.isArray(response)) {
        dependencies.fail(
          "github_api_response_invalid",
          "GitHub feedback reconciliation response is invalid",
        );
      }
      for (const item of /** @type {any[]} */ (response)) {
        if (matches(item)) {
          if (!Number.isSafeInteger(item.id) || item.id <= 0) {
            dependencies.fail(
              "github_api_response_invalid",
              "GitHub feedback reconciliation response is invalid",
            );
          }
          identities.push(item.id);
        }
      }
      if (response.length < 100) {
        break;
      }
    }
    if (identities.length > 1) {
      dependencies.fail(
        "github_delivery_identity_conflict",
        "GitHub feedback reconciliation found duplicate source identities",
      );
    }
    return identities[0] ?? null;
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
      /** @type {number} */ (response.id) <= 0 ||
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
      ["LEFT", "RIGHT"].includes(/** @type {string} */ (comment?.start_side));
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
      /** @type {number} */ (response.id) <= 0 ||
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

  /**
   * @param {any} credential
   * @param {number} installationId
   * @param {{full_name: string, id: number}} repository
   * @param {number} pullRequestNumber
   * @param {number} originalCommentId
   * @param {string} body
   */
  async function publishReply(
    credential,
    installationId,
    repository,
    pullRequestNumber,
    originalCommentId,
    body,
  ) {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !validRepository(repository) ||
      !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber <= 0 ||
      !Number.isSafeInteger(originalCommentId) ||
      originalCommentId <= 0 ||
      typeof body !== "string" ||
      body.length === 0
    ) {
      throw new TypeError("GitHub review-comment reply input is invalid");
    }
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    const fullName = repository.full_name
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const response = object(
      await dependencies.request(
        `/repos/${fullName}/pulls/${pullRequestNumber}/comments/${originalCommentId}/replies`,
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
      /** @type {number} */ (response.id) <= 0 ||
      response.body !== body ||
      response.in_reply_to_id !== originalCommentId
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub review-comment reply response is invalid",
      );
    }
    return /** @type {number} */ (response.id);
  }

  return {
    publishAggregate,
    publishInline,
    publishReply,
    /**
     * @param {any} credential
     * @param {number} installationId
     * @param {{full_name: string, id: number}} repository
     * @param {number} pullRequestNumber
     * @param {string} body
     */
    reconcileAggregate(
      credential,
      installationId,
      repository,
      pullRequestNumber,
      body,
    ) {
      const adjudicationId = sourceIdentity(body, "Adjudication");
      const evaluationId = sourceIdentity(body, "Evaluation");
      return reconcile(
        credential,
        installationId,
        repository,
        pullRequestNumber,
        "issues",
        (item) =>
          typeof item?.body === "string" &&
          (adjudicationId
            ? sourceIdentity(item.body, "Adjudication") === adjudicationId
            : evaluationId
              ? sourceIdentity(item.body, "Evaluation") === evaluationId &&
                sourceIdentity(item.body, "Adjudication") === null
              : item.body === body),
      );
    },
    /**
     * @param {any} credential
     * @param {number} installationId
     * @param {{full_name: string, id: number}} repository
     * @param {number} pullRequestNumber
     * @param {any} comment
     */
    reconcileInline(
      credential,
      installationId,
      repository,
      pullRequestNumber,
      comment,
    ) {
      const evaluationId = sourceIdentity(comment?.body, "Evaluation");
      const findingId = sourceIdentity(comment?.body, "Finding");
      return reconcile(
        credential,
        installationId,
        repository,
        pullRequestNumber,
        "pulls",
        (item) =>
          typeof item?.body === "string" &&
          (evaluationId && findingId
            ? sourceIdentity(item.body, "Evaluation") === evaluationId &&
              sourceIdentity(item.body, "Finding") === findingId
            : item.body === comment.body) &&
          item.commit_id === comment.commit_id &&
          item.path === comment.path &&
          item.line === comment.line &&
          item.side === comment.side &&
          (comment.start_line === undefined
            ? item.start_line === null
            : item.start_line === comment.start_line) &&
          (comment.start_side === undefined
            ? item.start_side === null
            : item.start_side === comment.start_side),
      );
    },
    /**
     * @param {any} credential
     * @param {number} installationId
     * @param {{full_name: string, id: number}} repository
     * @param {number} pullRequestNumber
     * @param {number} originalCommentId
     * @param {string} body
     */
    reconcileReply(
      credential,
      installationId,
      repository,
      pullRequestNumber,
      originalCommentId,
      body,
    ) {
      const adjudicationId = sourceIdentity(body, "Adjudication");
      const findingId = sourceIdentity(body, "Finding");
      return reconcile(
        credential,
        installationId,
        repository,
        pullRequestNumber,
        "pulls",
        (item) =>
          typeof item?.body === "string" &&
          item.in_reply_to_id === originalCommentId &&
          (adjudicationId && findingId
            ? sourceIdentity(item.body, "Adjudication") === adjudicationId &&
              sourceIdentity(item.body, "Finding") === findingId
            : item.body === body),
      );
    },
  };
}
