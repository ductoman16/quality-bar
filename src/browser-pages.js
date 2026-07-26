import { BROWSER_CSRF_COOKIE_NAME } from "./browser-session.js";

function browserConfiguration(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

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
    if (destination.origin !== "http://quality-bar.internal") {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

export function browserView(requestUrl) {
  const view = requestUrl.searchParams.get("view") ?? "evaluations";
  if (
    !["evaluations", "reviews", "repositories", "analytics", "system"].includes(
      view,
    )
  ) {
    const error = new Error("Resource was not found");
    error.code = "not_found";
    throw error;
  }
  return view;
}

export function loginPage(intendedDestination) {
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script id="browser-configuration" type="application/json">${browserConfiguration({ intendedDestination })}</script><script src="/assets/login.js"></script>`;
}

export function operatorPage({ view }) {
  const navigation = [
    "evaluations",
    "reviews",
    "repositories",
    "analytics",
    "system",
  ];
  const navigationLinks = navigation
    .map((name) => {
      const label = name[0].toUpperCase() + name.slice(1);
      return `<a${view === name ? ' aria-current="page"' : ""} href="/?view=${name}">${label}</a>`;
    })
    .join("");
  const attention = `<a hidden href="/?view=system" id="attention"></a>${
    view === "system" ? "" : "<style>details{display:none}</style>"
  }`;
  const heading = view[0].toUpperCase() + view.slice(1);
  const systemSection =
    view === "system"
      ? '<section aria-live="polite" id="system-facts"></section>'
      : "";
  const reviewSection =
    view === "reviews"
      ? '<form id="review-create-form"><label for="review-name">Name</label><input id="review-name" name="name" required type="text"><label for="review-description">Description</label><textarea id="review-description" name="description" required></textarea><ol id="review-criteria"></ol><button id="review-add-criterion" type="button">Add criterion</button><label for="review-model">Codex model</label><select id="review-model" name="model" required></select><label for="review-reasoning-effort">Reasoning effort</label><select id="review-reasoning-effort" name="reasoning_effort" required></select><label for="review-service-tier">Service tier</label><select id="review-service-tier" name="service_tier" required></select><button id="review-create-submit" type="submit">Create Review</button><output aria-live="polite" id="review-create-result"></output></form>'
      : "";
  return `<header><nav aria-label="Primary">${navigationLinks}</nav>${attention}</header><main><h1>${heading}</h1>${reviewSection}${systemSection}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button type="submit">Revoke implementer token</button></form><button id="logout" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" type="button">Done</button></dialog><p hidden id="error" role="alert"></p></main><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/operator.js"></script>`;
}
