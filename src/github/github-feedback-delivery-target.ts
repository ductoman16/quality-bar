function parseTarget(serialized: string, provider: "Forgejo" | "GitHub") {
  let target;
  try {
    target = JSON.parse(serialized);
  } catch {
    throw new TypeError(`${provider} feedback delivery target is invalid`);
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError(`${provider} feedback delivery target is invalid`);
  }
  return target;
}

export function readAggregateDeliveryTarget(
  serialized: string,
  fallback: any,
  repositoryId: number,
  provider: "Forgejo" | "GitHub" = "GitHub",
) {
  const target = parseTarget(serialized, provider);
  const keys = Object.keys(target).sort().join(",");
  if (
    keys === "pull_request_number,repository_id" &&
    target.pull_request_number === fallback.pull_request_number &&
    target.repository_id === repositoryId
  ) {
    return {
      body: fallback.body,
      pullRequestNumber: fallback.pull_request_number,
    };
  }
  const evaluationId = githubFeedbackSourceIdentity(
    fallback.body,
    "Evaluation",
  );
  if (
    keys !== "body,pull_request_number,repository_id" ||
    typeof target.body !== "string" ||
    target.body.length === 0 ||
    evaluationId === null ||
    githubFeedbackSourceIdentity(target.body, "Evaluation") !== evaluationId ||
    !Number.isSafeInteger(target.pull_request_number) ||
    target.pull_request_number <= 0 ||
    target.pull_request_number !== fallback.pull_request_number ||
    target.repository_id !== repositoryId
  ) {
    throw new TypeError(`${provider} feedback delivery target is invalid`);
  }
  return {
    body: target.body,
    pullRequestNumber: target.pull_request_number,
  };
}

export function readInlineDeliveryTarget(
  serialized: string,
  fallback: any,
  repositoryId: number,
  provider: "Forgejo" | "GitHub" = "GitHub",
) {
  const target = parseTarget(serialized, provider);
  const keys = Object.keys(target).sort().join(",");
  const legacy =
    keys ===
      "line,path,pull_request_number,repository_id,side,start_line,start_side" &&
    target.line === fallback.line &&
    target.path === fallback.path &&
    target.pull_request_number === fallback.pull_request_number &&
    target.repository_id === repositoryId &&
    target.side === fallback.side &&
    target.start_line === (fallback.start_line ?? null) &&
    target.start_side === (fallback.start_side ?? null);
  if (legacy) {
    return {
      comment: {
        body: fallback.body,
        commit_id: fallback.commit_id,
        line: fallback.line,
        path: fallback.path,
        side: fallback.side,
        ...(fallback.start_line === undefined
          ? {}
          : {
              start_line: fallback.start_line,
              start_side: fallback.start_side,
            }),
      },
      pullRequestNumber: fallback.pull_request_number,
    };
  }
  const singleLine =
    keys === "body,commit_id,line,path,pull_request_number,repository_id,side";
  const range =
    keys ===
    "body,commit_id,line,path,pull_request_number,repository_id,side,start_line,start_side";
  const evaluationId = githubFeedbackSourceIdentity(
    fallback.body,
    "Evaluation",
  );
  const findingId = githubFeedbackSourceIdentity(fallback.body, "Finding");
  if (
    (!singleLine && !range) ||
    typeof target.body !== "string" ||
    target.body.length === 0 ||
    typeof target.commit_id !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(target.commit_id) ||
    target.commit_id !== fallback.commit_id ||
    evaluationId === null ||
    githubFeedbackSourceIdentity(target.body, "Evaluation") !== evaluationId ||
    findingId === null ||
    githubFeedbackSourceIdentity(target.body, "Finding") !== findingId ||
    !Number.isSafeInteger(target.line) ||
    target.line <= 0 ||
    target.line !== fallback.line ||
    typeof target.path !== "string" ||
    target.path.length === 0 ||
    target.path !== fallback.path ||
    !Number.isSafeInteger(target.pull_request_number) ||
    target.pull_request_number <= 0 ||
    target.pull_request_number !== fallback.pull_request_number ||
    target.repository_id !== repositoryId ||
    !["LEFT", "RIGHT"].includes(target.side) ||
    target.side !== fallback.side ||
    (target.start_line ?? null) !== (fallback.start_line ?? null) ||
    (target.start_side ?? null) !== (fallback.start_side ?? null) ||
    (range &&
      (!Number.isSafeInteger(target.start_line) ||
        target.start_line <= 0 ||
        !["LEFT", "RIGHT"].includes(target.start_side)))
  ) {
    throw new TypeError(`${provider} feedback delivery target is invalid`);
  }
  return {
    comment: {
      body: target.body,
      commit_id: target.commit_id,
      line: target.line,
      path: target.path,
      side: target.side,
      ...(singleLine
        ? {}
        : {
            start_line: target.start_line,
            start_side: target.start_side,
          }),
    },
    pullRequestNumber: target.pull_request_number,
  };
}
import { githubFeedbackSourceIdentity } from "./github-feedback-identity.ts";
