/** @param {unknown} value */
export function safeInternalDestination(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  try {
    const destination = new URL(value, "http://quality-bar.internal");
    return destination.origin === "http://quality-bar.internal"
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/";
  } catch {
    return "/";
  }
}

/** @param {URL} requestUrl */
export function browserView(requestUrl) {
  const view = requestUrl.searchParams.get("view") ?? "evaluations";
  if (
    ![
      "evaluations",
      "evaluation-detail",
      "reviews",
      "review-detail",
      "repositories",
      "repository-detail",
      "analytics",
      "system",
    ].includes(view)
  ) {
    throw Object.assign(new Error("Resource was not found"), {
      code: "not_found",
    });
  }
  return view;
}
