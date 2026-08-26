import { GitHubConnectionError } from "./github-connection-error.ts";
import { pullRequestSnapshot } from "./github-pull-request-snapshot.ts";

function nextPage(value: unknown, currentPage: number) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new GitHubConnectionError(
      "github_poll_response_invalid",
      "GitHub pull request pagination is invalid",
    );
  }
  const links = value.split(",").map((part) => {
    const trimmed = part.trim();
    const closingBracket = trimmed.indexOf(">");
    if (!trimmed.startsWith("<") || closingBracket <= 1) {
      throw new GitHubConnectionError(
        "github_poll_response_invalid",
        "GitHub pull request pagination is invalid",
      );
    }
    const parameters = trimmed
      .slice(closingBracket + 1)
      .split(";")
      .map((parameter) => parameter.trim());
    const relation = parameters.at(-1);
    if (
      parameters[0] !== "" ||
      parameters.slice(1, -1).some((parameter) => parameter.length === 0) ||
      typeof relation !== "string" ||
      !relation.startsWith('rel="') ||
      !relation.endsWith('"') ||
      relation.length <= 6 ||
      relation.slice(5, -1).includes('"')
    ) {
      throw new GitHubConnectionError(
        "github_poll_response_invalid",
        "GitHub pull request pagination is invalid",
      );
    }
    return {
      relations: relation.slice(5, -1).split(/\s+/),
      url: trimmed.slice(1, closingBracket),
    };
  });
  const next = links.filter(({ relations }) => relations.includes("next"));
  const last = links.filter(({ relations }) => relations.includes("last"));
  if (last.length > 1) {
    throw new GitHubConnectionError(
      "github_poll_response_invalid",
      "GitHub pull request pagination is invalid",
    );
  }
  const pageNumber = (link: { url: string }) => {
    const value = link.url;
    let url;
    try {
      url = new URL(value);
    } catch (cause) {
      throw new GitHubConnectionError(
        "github_poll_response_invalid",
        "GitHub pull request pagination is invalid",
        { cause },
      );
    }
    const page = Number(url.searchParams.get("page"));
    if (
      !Number.isSafeInteger(page) ||
      url.searchParams.get("state") !== "all" ||
      url.searchParams.get("per_page") !== "100"
    ) {
      throw new GitHubConnectionError(
        "github_poll_response_invalid",
        "GitHub pull request pagination is invalid",
      );
    }
    return page;
  };
  const lastPage = last.length === 0 ? null : pageNumber(last[0]);
  if (next.length === 0) {
    if (lastPage !== null && lastPage !== currentPage) {
      throw new GitHubConnectionError(
        "github_poll_response_invalid",
        "GitHub pull request pagination is invalid",
      );
    }
    return null;
  }
  if (next.length !== 1) {
    throw new GitHubConnectionError(
      "github_poll_response_invalid",
      "GitHub pull request pagination is invalid",
    );
  }
  const page = pageNumber(next[0]);
  if (page !== currentPage + 1 || (lastPage !== null && lastPage < page)) {
    throw new GitHubConnectionError(
      "github_poll_response_invalid",
      "GitHub pull request pagination is invalid",
    );
  }
  return page;
}

export function createGitHubPullRequestReader({
  installationToken,
  request,
}: {
  installationToken: (
    credential: any,
    installationId: number,
  ) => Promise<string>;
  request: (path: string, options?: any) => Promise<unknown>;
}) {
  return async function listPullRequests(
    credential: any,
    installationId: number,
    repository: { id?: unknown; full_name?: unknown },
  ) {
    if (
      typeof repository?.full_name !== "string" ||
      !/^[^/]+\/[^/]+$/.test(repository.full_name)
    ) {
      throw new GitHubConnectionError(
        "github_poll_repository_invalid",
        "GitHub polling Repository is invalid",
      );
    }
    const token = await installationToken(credential, installationId);
    const pullRequests: unknown[] = [];
    for (let page = 1; ; ) {
      const pageResponse = (await request(
        `/repos/${repository.full_name}/pulls?state=all&per_page=100&page=${page}`,
        {
          ...(Number.isSafeInteger(repository.id)
            ? {
                affectedRepositoryIds: [repository.id],
                repositoryId: repository.id,
              }
            : {}),
          authorization: token,
          includePage: true,
        },
      )) as any;
      if (
        !pageResponse ||
        typeof pageResponse !== "object" ||
        !("body" in pageResponse) ||
        !("link" in pageResponse)
      ) {
        throw new GitHubConnectionError(
          "github_poll_response_invalid",
          "GitHub pull request snapshot is invalid",
        );
      }
      const response = pullRequestSnapshot(pageResponse.body);
      pullRequests.push(...response);
      const next = nextPage(pageResponse.link, page);
      if (next === null) {
        return pullRequestSnapshot(pullRequests);
      }
      page = next;
    }
  };
}
