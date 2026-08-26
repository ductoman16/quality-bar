const CONNECTION_SCOPED_VERIFICATION_ERRORS = new Set([
  "github_api_request_failed",
  "github_api_response_invalid",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_installation_mismatch",
  "github_installation_scope_invalid",
  "github_permissions_mismatch",
  "github_personal_account_required",
  "github_principal_mismatch",
  "github_private_repository_required",
  "github_repository_enumeration_incomplete",
  "github_repository_identity_invalid",
]);
const REPOSITORY_SCOPED_VERIFICATION_ERRORS = new Set([
  "github_private_git_read_failed",
  "github_repository_api_access_failed",
  "github_repository_git_read_failed",
  "github_repository_selection_unavailable",
]);

export function githubVerificationErrorScope(code: string) {
  return CONNECTION_SCOPED_VERIFICATION_ERRORS.has(code)
    ? "connection"
    : REPOSITORY_SCOPED_VERIFICATION_ERRORS.has(code)
      ? "repository"
      : null;
}
