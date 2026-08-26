import { githubFeedbackSourceIdentity as sourceIdentity } from "./github-feedback-identity.ts";

function object(value: unknown) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function validRepository(repository: { full_name: string; id: number }) {
  return (
    Number.isSafeInteger(repository?.id) &&
    repository.id > 0 &&
    typeof repository.full_name === "string" &&
    /^[^/]+\/[^/]+$/.test(repository.full_name)
  );
}

export function createGitHubFeedbackPublisher(dependencies: {
  fail: (code: string, message: string) => never;
  installationToken: (
    credential: any,
    installationId: number,
  ) => Promise<string>;
  request: (path: string, options: any) => Promise<unknown>;
}) {
  function path(
    repository: { full_name: string },
    pullRequestNumber: number,
    collection: string,
  ) {
    const fullName = repository.full_name
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `/repos/${fullName}/${collection}/${pullRequestNumber}/comments`;
  }

  async function reconcile(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    pullRequestNumber: number,
    collection: "issues" | "pulls",
    matches: (item: any) => boolean,
  ) {
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    const identities: number[] = [];
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
      for (const item of response as any[]) {
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

  async function publishAggregate(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    pullRequestNumber: number,
    body: string,
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
      (response.id as number) <= 0 ||
      response.body !== body
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub aggregate feedback response is invalid",
      );
    }
    return response.id as number;
  }

  async function publishInline(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    pullRequestNumber: number,
    comment: {
      body: string;
      commit_id: string;
      line: number;
      path: string;
      side: "LEFT" | "RIGHT";
      start_line?: number;
      start_side?: "LEFT" | "RIGHT";
    },
  ) {
    const startLine = comment?.start_line;
    const singleLine =
      startLine === undefined && comment?.start_side === undefined;
    const range =
      Number.isSafeInteger(startLine) &&
      (startLine as number) > 0 &&
      ["LEFT", "RIGHT"].includes(comment?.start_side as string);
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
      (response.id as number) <= 0 ||
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
    return response.id as number;
  }

  async function publishReply(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    pullRequestNumber: number,
    originalCommentId: number,
    body: string,
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
      (response.id as number) <= 0 ||
      response.body !== body ||
      response.in_reply_to_id !== originalCommentId
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub review-comment reply response is invalid",
      );
    }
    return response.id as number;
  }

  return {
    publishAggregate,
    publishInline,
    publishReply,
    reconcileAggregate(
      credential: any,
      installationId: number,
      repository: { full_name: string; id: number },
      pullRequestNumber: number,
      body: string,
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
    reconcileInline(
      credential: any,
      installationId: number,
      repository: { full_name: string; id: number },
      pullRequestNumber: number,
      comment: any,
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
    reconcileReply(
      credential: any,
      installationId: number,
      repository: { full_name: string; id: number },
      pullRequestNumber: number,
      originalCommentId: number,
      body: string,
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
