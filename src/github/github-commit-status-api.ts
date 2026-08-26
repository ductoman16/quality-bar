import { COMMIT_STATUS_CONTEXT as GITHUB_COMMIT_STATUS_CONTEXT } from "../forge/commit-status/status.ts";

function object(value: unknown) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function validTargetUrl(value: unknown) {
  try {
    return (
      typeof value === "string" &&
      ["http:", "https:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}

function evaluationIdentity(value: unknown) {
  try {
    const identity =
      typeof value === "string"
        ? new URL(value).searchParams.get("evaluation_id")
        : null;
    return identity && identity.length > 0 ? identity : null;
  } catch {
    return null;
  }
}

export function createGitHubCommitStatusPublisher(dependencies: {
  fail: (code: string, message: string) => never;
  installationToken: (
    credential: any,
    installationId: number,
  ) => Promise<string>;
  request: (path: string, options: any) => Promise<unknown>;
}) {
  function statusPath(repository: { full_name: string }, head: string) {
    return `/repos/${repository.full_name
      .split("/")
      .map(encodeURIComponent)
      .join("/")}/commits/${head}/statuses`;
  }

  async function publishCommitStatus(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    status: {
      description: string;
      head: string;
      state: string;
      targetUrl: string;
    },
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
      !Number.isSafeInteger(response.id) ||
      (response.id as number) <= 0 ||
      response.context !== GITHUB_COMMIT_STATUS_CONTEXT ||
      (response.sha !== undefined && response.sha !== status.head) ||
      response.state !== status.state ||
      response.target_url !== status.targetUrl
    ) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub commit status response is invalid",
      );
    }
    return response.id as number;
  }

  async function reconcileCommitStatus(
    credential: any,
    installationId: number,
    repository: { full_name: string; id: number },
    status: { head: string; state: string; targetUrl: string },
  ) {
    const authorization = await dependencies.installationToken(
      credential,
      installationId,
    );
    const evaluationId = evaluationIdentity(status.targetUrl);
    if (!evaluationId) {
      throw new TypeError("GitHub commit status input is invalid");
    }
    const matches: number[] = [];
    for (let page = 1; ; page += 1) {
      const response = await dependencies.request(
        `${statusPath(repository, status.head)}?per_page=100&page=${page}`,
        {
          affectedRepositoryIds: [repository.id],
          authorization,
          repositoryId: repository.id,
        },
      );
      if (!Array.isArray(response)) {
        dependencies.fail(
          "github_api_response_invalid",
          "GitHub commit status reconciliation response is invalid",
        );
      }
      for (const item of response as any[]) {
        if (
          item?.sha !== undefined &&
          item.sha !== null &&
          item.sha !== status.head
        ) {
          dependencies.fail(
            "github_api_response_invalid",
            "GitHub commit status reconciliation response is invalid",
          );
        }
        if (
          item?.context === GITHUB_COMMIT_STATUS_CONTEXT &&
          item.state === status.state &&
          evaluationIdentity(item.target_url) === evaluationId
        ) {
          if (!Number.isSafeInteger(item.id) || item.id <= 0) {
            dependencies.fail(
              "github_api_response_invalid",
              "GitHub commit status reconciliation response is invalid",
            );
          }
          matches.push(item.id);
        }
      }
      if (response.length < 100) {
        break;
      }
    }
    if (matches.length > 1) {
      dependencies.fail(
        "github_delivery_identity_conflict",
        "GitHub commit status reconciliation found duplicate source identities",
      );
    }
    return matches[0] ?? null;
  }

  return { publishCommitStatus, reconcileCommitStatus };
}
