import { renderAnalyticsPage } from "./analytics-page.js";
import { BROWSER_CSRF_COOKIE_NAME } from "./browser-session.js";
import { renderEvaluationMonitorPage } from "./evaluation-monitor-page.js";
import { renderRepositoryPage } from "./repository-page.js";
import { renderReviewPage } from "./review-page.js";
import { renderSystemPage } from "./system-page.js";

/** @param {{ intendedDestination?: string } | { csrfCookieName: string }} value */
function browserConfiguration(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

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
    if (destination.origin !== "http://quality-bar.internal") {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
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

/** @param {string} intendedDestination */
export function loginPage(intendedDestination) {
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button title="Log in" type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script id="browser-configuration" type="application/json">${browserConfiguration({ intendedDestination })}</script><script src="/assets/login.js"></script>`;
}

/** @param {{ view: string, evaluationId?: string | null }} options */
export function operatorPage({ view, evaluationId }) {
  void evaluationId;
  const leftNavigation = ["evaluations", "reviews", "repositories"];
  const rightNavigation = ["analytics", "system"];
  /** @param {string} name */
  const renderNavLink = (name) => {
    const label = name[0].toUpperCase() + name.slice(1);
    const active =
      view === name ||
      (name === "reviews" && view === "review-detail") ||
      (name === "repositories" && view === "repository-detail");
    return `<a${active ? ' aria-current="page"' : ""} href="/?view=${name}">${label}</a>`;
  };
  const leftLinks = leftNavigation.map(renderNavLink).join("");
  const rightLinks = rightNavigation.map(renderNavLink).join("");
  const navigationLinks = `<div class="qb-nav-group">${leftLinks}</div><div class="qb-nav-group">${rightLinks}</div>`;
  const attention = `<a hidden href="/?view=system" id="attention"></a>${
    view === "system" ? "" : "<style>main > details{display:none}</style>"
  }`;
  const heading = view[0].toUpperCase() + view.slice(1);
  const systemPage =
    view === "system" ? renderSystemPage() : { markup: "", scripts: "" };
  const analyticsPage =
    view === "analytics" ? renderAnalyticsPage() : { markup: "", scripts: "" };
  const evaluationPage = ["evaluations", "evaluation-detail"].includes(view)
    ? renderEvaluationMonitorPage(
        /** @type {"evaluations" | "evaluation-detail"} */ (view),
      )
    : { markup: "", scripts: "" };
  const reviewPage = ["reviews", "review-detail"].includes(view)
    ? renderReviewPage(/** @type {"reviews" | "review-detail"} */ (view))
    : { markup: "", scripts: "" };
  const repositoryPage = ["repositories", "repository-detail"].includes(view)
    ? renderRepositoryPage(
        /** @type {"repositories" | "repository-detail"} */ (view),
      )
    : { markup: "", scripts: "" };
  return `<div class="qb-app-shell"><header class="qb-header"><a class="qb-brand" href="/?view=evaluations" aria-label="Quality Bar">QB</a><span class="qb-brand-title">Quality Bar</span><nav aria-label="Primary" class="qb-primary-nav">${navigationLinks}</nav><div class="qb-header-actions"><button class="qb-theme-toggle" aria-label="Toggle theme" type="button">☼</button></div>${attention}</header><main class="qb-main">${["review-detail", "repository-detail"].includes(view) ? "" : `<h1 class="qb-page-heading">${heading}</h1>`}${evaluationPage.markup}${reviewPage.markup}${repositoryPage.markup}${analyticsPage.markup}${systemPage.markup}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button title="Change password" type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button title="Revoke all sessions" type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button title="Create implementer token" type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button title="Rotate implementer token" type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button title="Revoke implementer token" type="submit">Revoke implementer token</button></form><button id="logout" title="Log out" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" title="Done" type="button">Done</button></dialog><p hidden id="error" role="alert" tabindex="-1"></p></main></div><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/system-attention.js"></script><script src="/assets/operator.js"></script>${evaluationPage.scripts}${repositoryPage.scripts}${reviewPage.scripts}${analyticsPage.scripts}${systemPage.scripts}`;
}
