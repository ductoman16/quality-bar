/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
function readTarget(serialized, fallback, repositoryId) {
  let target;
  try {
    target = JSON.parse(serialized);
  } catch {
    throw new TypeError("GitHub feedback delivery target is invalid");
  }
  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    ("repository_id" in target && target.repository_id !== repositoryId)
  ) {
    throw new TypeError("GitHub feedback delivery target is invalid");
  }
  return typeof target.body === "string" ? target : fallback;
}

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readAggregateDeliveryTarget(
  serialized,
  fallback,
  repositoryId,
) {
  const target = readTarget(serialized, fallback, repositoryId);
  return {
    body: target.body,
    pullRequestNumber: target.pull_request_number,
  };
}

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
export function readInlineDeliveryTarget(serialized, fallback, repositoryId) {
  const target = readTarget(serialized, fallback, repositoryId);
  return {
    comment: {
      body: target.body,
      commit_id: target.commit_id,
      line: target.line,
      path: target.path,
      side: target.side,
      ...(target.start_line === null
        ? {}
        : {
            start_line: target.start_line,
            start_side: target.start_side,
          }),
    },
    pullRequestNumber: target.pull_request_number,
  };
}
