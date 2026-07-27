/** @param {Record<string, unknown>} properties @param {string[]} required */
const closedObject = (properties, required) => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

export function canonicalGitHubConnectionSchemas() {
  return {
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
      ["clone_url", "full_name", "id", "private"],
    ),
    GitHubRepositorySelectionRequest: closedObject(
      {
        repository_ids: {
          items: { minimum: 1, type: "integer" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
      },
      ["repository_ids"],
    ),
    GitHubConnectionVerification: {
      ...closedObject(
        {
          api_profile: { const: "github-rest:2026-03-10", type: "string" },
          capabilities: {
            $ref: "#/components/schemas/GitHubCapabilityEvidence",
          },
          error: {
            oneOf: [
              { $ref: "#/components/schemas/GitHubConnectionHealthError" },
              { type: "null" },
            ],
          },
          id: { minLength: 1, type: "string" },
          outcome: { enum: ["success", "error"], type: "string" },
          permissions: { $ref: "#/components/schemas/GitHubPermissions" },
          principal: { $ref: "#/components/schemas/GitHubPrincipal" },
          repositories: {
            items: { $ref: "#/components/schemas/GitHubRepositoryEvidence" },
            minItems: 1,
            type: "array",
          },
          trigger: {
            enum: ["onboarding", "repository_selection", "enablement"],
            type: "string",
          },
          verified_at: { minimum: 0, type: "integer" },
        },
        [
          "api_profile",
          "capabilities",
          "error",
          "id",
          "outcome",
          "permissions",
          "principal",
          "repositories",
          "trigger",
          "verified_at",
        ],
      ),
      oneOf: [
        {
          properties: {
            error: { type: "null" },
            outcome: { const: "success" },
          },
          required: ["error", "outcome"],
        },
        {
          properties: {
            error: {
              $ref: "#/components/schemas/GitHubConnectionHealthError",
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
            $ref: "#/components/schemas/GitHubCapabilityEvidence",
          },
          health: { enum: ["healthy", "error"], type: "string" },
          health_error: {
            oneOf: [
              { $ref: "#/components/schemas/GitHubConnectionHealthError" },
              { type: "null" },
            ],
          },
          id: { minLength: 1, type: "string" },
          permissions: { $ref: "#/components/schemas/GitHubPermissions" },
          principal: { $ref: "#/components/schemas/GitHubPrincipal" },
          repository_count: { minimum: 1, type: "integer" },
          verification_history: {
            items: {
              $ref: "#/components/schemas/GitHubConnectionVerification",
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
          "permissions",
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
              $ref: "#/components/schemas/GitHubConnectionHealthError",
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
