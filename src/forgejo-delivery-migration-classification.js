export const DEFINITIVE_FAILURE_CODES = [
  "forgejo_connection_credential_invalid",
  "forgejo_connection_credential_undecryptable",
  "forgejo_connection_retired",
  "forgejo_publication_capability_unavailable",
  "forgejo_publication_request_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_capability_missing",
  "forgejo_repository_permission_denied",
  "forgejo_required_route_unavailable",
  "forgejo_version_unsupported",
]
  .map((code) => `'${code}'`)
  .join(", ");

export const DEFINITIVE_REQUEST = `(
  error_code = 'forgejo_api_request_failed'
  AND error_detail GLOB '*HTTP 4[0-9][0-9]*'
  AND error_detail NOT GLOB '*HTTP 408*'
  AND error_detail NOT GLOB '*HTTP 425*'
  AND error_detail NOT GLOB '*HTTP 429*'
)`;
