import { GITHUB_COMMIT_STATUS_CONTEXT } from "./github-commit-status.js";

/** @param {unknown} value */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value */
function validTargetUrl(value) {
  try {
    return (
      typeof value === "string" &&
      ["http:", "https:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   fail: (code: string, message: string) => never,
 *   installationToken: (credential: any, installationId: number) => Promise<string>,
 *   request: (path: string, options: any) => Promise<unknown>
 * }} dependencies
 */
export function createGitHubCommitStatusPublisher(dependencies) {
  /**
   * @param {any} credential
   * @param {number} installationId
   * @param {{full_name: string, id: number}} repository
   * @param {{description: string, head: string, state: string, targetUrl: string}} status
   */
  return async function publishCommitStatus(
    credential,
    installationId,
    repository,
    status,
  ) {
    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !Number.isSafeInteger(repository?.id) ||
      repository.id <= 0 ||
      typeof repository.full_name !== "string" ||
      !/^[^/]+\/[^/]+$/.test(repository.full_name) ||
      typeof status?.head !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(status.head) ||
      !["pending", "success", "failure", "error"].includes(status.state) ||
      typeof status.description !== "string" ||
      status.description.length === 0 ||
      status.description.length > 140 ||
      !validTargetUrl(status.targetUrl)
    ) {
      throw new TypeError("GitHub commit status input is invalid");
    }
    const token = await dependencies.installationToken(
      credential,
      installationId,
    );
    const response = object(
      await dependencies.request(
        `/repos/${repository.full_name
          .split("/")
          .map(encodeURIComponent)
          .join("/")}/statuses/${status.head}`,
        {
          affectedRepositoryIds: [repository.id],
          authorization: token,
          body: {
            context: GITHUB_COMMIT_STATUS_CONTEXT,
            description: status.description,
            state: status.state,
            target_url: status.targetUrl,
          },
          method: "POST",
          repositoryId: repository.id,
        },
      ),
    );
    if (
      !response ||
      response.context !== GITHUB_COMMIT_STATUS_CONTEXT ||
      response.sha !== status.head ||
      response.state !== status.state ||
      response.target_url !== status.targetUrl
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub commit status response is invalid",
      );
    }
  };
}
