export function forgejoOpenApi() {
  const operations = [
    ["/repos/search", "get", "200"],
    ["/repos/{owner}/{repo}", "get", "200"],
    ["/repos/{owner}/{repo}/branches", "get", "200"],
    ["/repos/{owner}/{repo}/pulls", "get", "200"],
    ["/repos/{owner}/{repo}/issues/comments", "get", "200"],
    ["/repos/{owner}/{repo}/statuses/{sha}", "post", "201"],
    ["/repos/{owner}/{repo}/statuses/{sha}", "get", "200"],
    ["/repos/{owner}/{repo}/issues/{index}/comments", "post", "201"],
    ["/repos/{owner}/{repo}/issues/{index}/comments", "get", "200"],
    ["/repos/{owner}/{repo}/pulls/{index}/reviews", "post", "200"],
    ["/repos/{owner}/{repo}/pulls/{index}/reviews", "get", "200"],
    ["/repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments", "get", "200"],
  ];
  return {
    paths: operations.reduce(
      (paths, [path, method, status]) => ({
        ...paths,
        [path]: {
          ...paths[path],
          [method]: { responses: { [status]: {} } },
        },
      }),
      /** @type {Record<string, any>} */ ({}),
    ),
    swagger: "2.0",
  };
}
