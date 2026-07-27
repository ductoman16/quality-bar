export const GITHUB_API_PROFILE = "github-rest:2026-03-10";

export const GITHUB_REQUIRED_PERMISSIONS = Object.freeze({
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
});

export const GITHUB_VERIFIED_CAPABILITIES = Object.freeze({
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
});

/**
 * @param {{externalOrigin: string, state: string}} options
 */
export function createGitHubAppManifest({ externalOrigin, state }) {
  let origin;
  try {
    origin = new URL(externalOrigin);
  } catch (cause) {
    throw new TypeError("GitHub manifest requires an HTTPS external origin", {
      cause,
    });
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== externalOrigin ||
    (origin.pathname !== "/" && origin.pathname !== "")
  ) {
    throw new TypeError("GitHub manifest requires an HTTPS external origin");
  }
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(state)) {
    throw new TypeError("GitHub manifest state is invalid");
  }
  const callback = `${externalOrigin}/api/v1/github-connections`;
  return {
    callback_urls: [],
    default_events: [],
    default_permissions: GITHUB_REQUIRED_PERMISSIONS,
    description: "Quality Bar personal GitHub Connection",
    hook_attributes: {
      active: false,
      url: `${callback}/webhook-unsupported`,
    },
    name: "Quality Bar",
    public: false,
    redirect_url: `${callback}/manifest/callback`,
    request_oauth_on_install: false,
    setup_on_update: false,
    setup_url: `${callback}/setup?state=${state}`,
    url: externalOrigin,
  };
}
