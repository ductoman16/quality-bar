/** @param {string} serialized */
function parseTarget(serialized) {
  let target;
  try {
    target = JSON.parse(serialized);
  } catch {
    throw new TypeError("GitHub feedback delivery target is invalid");
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("GitHub feedback delivery target is invalid");
  }
  return target;
}

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readAggregateDeliveryTarget(
  serialized,
  fallback,
  repositoryId,
) {
  const target = parseTarget(serialized);
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
  if (
    keys !== "body,pull_request_number,repository_id" ||
    typeof target.body !== "string" ||
    target.body.length === 0 ||
    !Number.isSafeInteger(target.pull_request_number) ||
    target.pull_request_number <= 0 ||
    target.repository_id !== repositoryId
  ) {
    throw new TypeError("GitHub feedback delivery target is invalid");
  }
  return {
    body: target.body,
    pullRequestNumber: target.pull_request_number,
  };
}

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readInlineDeliveryTarget(serialized, fallback, repositoryId) {
  const target = parseTarget(serialized);
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
  if (
    (!singleLine && !range) ||
    typeof target.body !== "string" ||
    target.body.length === 0 ||
    typeof target.commit_id !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(target.commit_id) ||
    !Number.isSafeInteger(target.line) ||
    target.line <= 0 ||
    typeof target.path !== "string" ||
    target.path.length === 0 ||
    !Number.isSafeInteger(target.pull_request_number) ||
    target.pull_request_number <= 0 ||
    target.repository_id !== repositoryId ||
    !["LEFT", "RIGHT"].includes(target.side) ||
    (range &&
      (!Number.isSafeInteger(target.start_line) ||
        target.start_line <= 0 ||
        !["LEFT", "RIGHT"].includes(target.start_side)))
  ) {
    throw new TypeError("GitHub feedback delivery target is invalid");
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
