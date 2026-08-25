/** @param {unknown} value */
function evaluationTargetIdentity(value) {
  try {
    const target = new URL(/** @type {string} */ (value));
    const keys = [...target.searchParams.keys()].sort().join(",");
    return target.pathname === "/" &&
      target.hash === "" &&
      keys === "evaluation_id,view" &&
      target.searchParams.get("view") === "evaluations"
      ? target.searchParams.get("evaluation_id")
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} serialized
 * @param {any} fallback
 * @param {number} repositoryId
 * @param {"Forgejo" | "GitHub"} provider
 */
export function readStatusTarget(serialized, fallback, repositoryId, provider) {
  let target;
  try {
    target = JSON.parse(serialized);
  } catch {
    throw new TypeError(`${provider} commit status delivery target is invalid`);
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError(`${provider} commit status delivery target is invalid`);
  }
  const keys = Object.keys(target).sort().join(",");
  if (
    keys === "context,head_commit,repository_id,state" &&
    target.context === "Quality Bar" &&
    target.head_commit === fallback.head &&
    target.repository_id === repositoryId &&
    target.state === fallback.state
  ) {
    return fallback;
  }
  if (
    keys !== "context,description,head,repository_id,state,target_url" ||
    target.context !== "Quality Bar" ||
    target.repository_id !== repositoryId ||
    typeof target.description !== "string" ||
    typeof target.head !== "string" ||
    target.head !== fallback.head ||
    target.state !== fallback.state ||
    typeof target.target_url !== "string" ||
    evaluationTargetIdentity(target.target_url) === null ||
    evaluationTargetIdentity(target.target_url) !==
      evaluationTargetIdentity(fallback.targetUrl)
  ) {
    throw new TypeError(`${provider} commit status delivery target is invalid`);
  }
  return {
    description: target.description,
    head: target.head,
    state: target.state,
    targetUrl: target.target_url,
  };
}
