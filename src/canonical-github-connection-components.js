import { canonicalGitHubPollingSchemas } from "./canonical-github-polling-components.js";

/** @param {Record<string, unknown>} properties @param {string[]} required */
const closedObject = (properties, required) => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

export function canonicalGitHubConnectionSchemas() {
  return {
    ...canonicalGitHubPollingSchemas(),
    GitHubCallbackFailure: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    GitHubConnectionHealthError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    GitHubVerificationError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
        repository_id: {
          oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
        },
      },
      ["code", "message", "repository_id"],
    ),
    GitHubCapabilityEvidence: closedObject(
      Object.fromEntries(
        [
          "aggregate_feedback",
          "branch_access",
          "commit_status",
          "enumeration",
          "inline_feedback",
          "private_git_read",
          "pull_request_access",
        ].map((name) => [name, { const: "verified", type: "string" }]),
      ),
      [
        "aggregate_feedback",
        "branch_access",
        "commit_status",
        "enumeration",
        "inline_feedback",
        "private_git_read",
        "pull_request_access",
      ],
    ),
    GitHubPermissions: closedObject(
      {
        contents: { const: "read", type: "string" },
        issues: { const: "write", type: "string" },
        metadata: { const: "read", type: "string" },
        pull_requests: { const: "write", type: "string" },
        statuses: { const: "write", type: "string" },
      },
      ["contents", "issues", "metadata", "pull_requests", "statuses"],
    ),
    GitHubPrincipal: closedObject(
      {
        id: { minimum: 1, type: "integer" },
        login: { minLength: 1, type: "string" },
        type: { const: "User", type: "string" },
      },
      ["id", "login", "type"],
    ),
    GitHubRepositoryEvidence: closedObject(
      {
        api_url: { format: "uri", type: "string" },
        clone_url: { format: "uri", type: "string" },
        full_name: { minLength: 3, type: "string" },
        html_url: { format: "uri", type: "string" },
        id: { minimum: 1, type: "integer" },
        private: { type: "boolean" },
      },
      ["api_url", "clone_url", "full_name", "html_url", "id", "private"],
    ),
    GitHubRepositoryVerificationCheck: closedObject(
      {
        outcome: {
          enum: ["success", "error", "not_completed"],
          type: "string",
        },
        repository_id: { minimum: 1, type: "integer" },
      },
      ["repository_id", "outcome"],
    ),
    GitHubRepositorySelectionRequest: closedObject(
      {
        repository_ids: {
          items: { minimum: 1, type: "integer" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        request_id: {
          format: "uuid",
          pattern:
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          type: "string",
        },
      },
      ["repository_ids", "request_id"],
    ),
    GitHubConnectionRetirementRequest: closedObject(
      { lifecycle: { const: "retired", type: "string" } },
      ["lifecycle"],
    ),
    GitHubConnectionReactivationRequest: closedObject(
      { pem: { minLength: 1, type: "string", writeOnly: true } },
      ["pem"],
    ),
    GitHubConnectionCredentialRotationRequest: closedObject(
      { pem: { minLength: 1, type: "string", writeOnly: true } },
      ["pem"],
    ),
    GitHubConnectionVerification: {
      ...closedObject(
        {
          affected_repository_ids: {
            items: { minimum: 1, type: "integer" },
            minItems: 1,
            type: "array",
            uniqueItems: true,
          },
          api_profile: {
            oneOf: [
              { const: "github-rest:2026-03-10", type: "string" },
              { type: "null" },
            ],
          },
          capabilities: {
            oneOf: [{ $ref: "GitHubCapabilityEvidence#" }, { type: "null" }],
          },
          error: {
            oneOf: [{ $ref: "GitHubVerificationError#" }, { type: "null" }],
          },
          id: { minLength: 1, type: "string" },
          outcome: { enum: ["success", "error"], type: "string" },
          permissions: {
            oneOf: [{ $ref: "GitHubPermissions#" }, { type: "null" }],
          },
          principal: {
            oneOf: [{ $ref: "GitHubPrincipal#" }, { type: "null" }],
          },
          repositories: {
            items: { $ref: "GitHubRepositoryEvidence#" },
            type: "array",
          },
          repository_checks: {
            items: {
              $ref: "GitHubRepositoryVerificationCheck#",
            },
            minItems: 1,
            type: "array",
          },
          trigger: {
            enum: [
              "onboarding",
              "repository_selection",
              "enablement",
              "rotation",
            ],
            type: "string",
          },
          verified_at: { minimum: 0, type: "integer" },
        },
        [
          "affected_repository_ids",
          "api_profile",
          "capabilities",
          "error",
          "id",
          "outcome",
          "permissions",
          "principal",
          "repositories",
          "repository_checks",
          "trigger",
          "verified_at",
        ],
      ),
      oneOf: [
        {
          properties: {
            api_profile: {
              const: "github-rest:2026-03-10",
              type: "string",
            },
            capabilities: {
              $ref: "GitHubCapabilityEvidence#",
            },
            error: { type: "null" },
            outcome: { const: "success" },
            permissions: { $ref: "GitHubPermissions#" },
            principal: { $ref: "GitHubPrincipal#" },
            repositories: { minItems: 1 },
            repository_checks: {
              items: closedObject(
                {
                  outcome: { const: "success", type: "string" },
                  repository_id: { minimum: 1, type: "integer" },
                },
                ["repository_id", "outcome"],
              ),
              minItems: 1,
              type: "array",
            },
          },
          required: [
            "api_profile",
            "capabilities",
            "error",
            "outcome",
            "permissions",
            "principal",
            "repositories",
            "repository_checks",
          ],
        },
        {
          properties: {
            error: {
              $ref: "GitHubVerificationError#",
            },
            outcome: { const: "error" },
          },
          required: ["error", "outcome"],
        },
      ],
    },
    GitHubConnection: {
      ...closedObject(
        {
          api_profile: { const: "github-rest:2026-03-10", type: "string" },
          app_id: { minimum: 1, type: "integer" },
          app_slug: { minLength: 1, type: "string" },
          capabilities: {
            $ref: "GitHubCapabilityEvidence#",
          },
          health: { enum: ["healthy", "error"], type: "string" },
          health_error: {
            oneOf: [{ $ref: "GitHubConnectionHealthError#" }, { type: "null" }],
          },
          id: { minLength: 1, type: "string" },
          lifecycle: { enum: ["enabled", "retired"], type: "string" },
          permissions: { $ref: "GitHubPermissions#" },
          polling: {
            items: { $ref: "GitHubPollingState#" },
            type: "array",
          },
          polling_failure: {
            oneOf: [{ $ref: "GitHubPollingFailure#" }, { type: "null" }],
          },
          principal: { $ref: "GitHubPrincipal#" },
          repository_count: { minimum: 1, type: "integer" },
          verification_history: {
            items: {
              $ref: "GitHubConnectionVerification#",
            },
            minItems: 1,
            type: "array",
          },
          verified_at: { minimum: 0, type: "integer" },
        },
        [
          "api_profile",
          "app_id",
          "app_slug",
          "capabilities",
          "health",
          "health_error",
          "id",
          "lifecycle",
          "permissions",
          "polling",
          "polling_failure",
          "principal",
          "repository_count",
          "verification_history",
          "verified_at",
        ],
      ),
      oneOf: [
        {
          properties: {
            health: { const: "healthy" },
            health_error: { type: "null" },
          },
          required: ["health", "health_error"],
        },
        {
          properties: {
            health: { const: "error" },
            health_error: {
              $ref: "GitHubConnectionHealthError#",
            },
          },
          required: ["health", "health_error"],
        },
      ],
    },
    GitHubManifestStart: closedObject(
      {
        action: {
          pattern:
            "^https://github\\.com/settings/apps/new\\?state=[A-Za-z0-9_-]{8,256}$",
          type: "string",
        },
        manifest: { type: "object" },
        method: { const: "POST", type: "string" },
        state: { minLength: 8, type: "string" },
      },
      ["action", "manifest", "method", "state"],
    ),
  };
}
