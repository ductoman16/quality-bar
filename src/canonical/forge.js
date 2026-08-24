import { closedObject } from "./schema.js";

export function canonicalGitHubDeliveryProperties() {
  const timestamp = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  return {
    attempt_count: { minimum: 0, type: "integer" },
    connection_identity: {
      oneOf: [{ minLength: 1, type: "string" }, { type: "null" }],
    },
    last_attempt_at: timestamp,
    next_attempt_at: timestamp,
    provider_gate_error: {
      oneOf: [{ $ref: "GitHubFeedbackPublicationError#" }, { type: "null" }],
    },
    provider_gate_until: timestamp,
    reconciliation_required: { type: "boolean" },
    source_identity: { minLength: 1, type: "string" },
    target: { minLength: 1, type: "string" },
  };
}

export const GITHUB_DELIVERY_REQUIRED = [
  "source_identity",
  "connection_identity",
  "target",
  "attempt_count",
  "last_attempt_at",
  "provider_gate_until",
  "provider_gate_error",
  "next_attempt_at",
  "reconciliation_required",
];

export function canonicalGitHubFeedbackSchemas() {
  const error = {
    oneOf: [{ $ref: "GitHubFeedbackPublicationError#" }, { type: "null" }],
  };
  const externalId = {
    oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
  };
  const publishedAt = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  return {
    GitHubFeedbackPublicationError: closedObject(
      {
        code: {
          pattern: "^[a-z][a-z0-9_]*$",
          type: "string",
        },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    GitHubAggregateFeedbackPublication: closedObject(
      {
        ...canonicalGitHubDeliveryProperties(),
        error,
        external_id: externalId,
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
        published_at: publishedAt,
      },
      [
        ...GITHUB_DELIVERY_REQUIRED,
        "publication_status",
        "external_id",
        "published_at",
        "error",
      ],
    ),
    GitHubFindingFeedbackPublication: closedObject(
      {
        ...canonicalGitHubDeliveryProperties(),
        error,
        external_id: externalId,
        finding_id: { minLength: 1, type: "string" },
        publication_status: {
          enum: ["aggregate_only", "waiting", "succeeded", "unavailable"],
          type: "string",
        },
        published_at: publishedAt,
      },
      [
        ...GITHUB_DELIVERY_REQUIRED,
        "finding_id",
        "publication_status",
        "external_id",
        "published_at",
        "error",
      ],
    ),
    GitHubEvaluationFeedback: closedObject(
      {
        aggregate: {
          $ref: "GitHubAggregateFeedbackPublication#",
        },
        findings: {
          items: {
            $ref: "GitHubFindingFeedbackPublication#",
          },
          type: "array",
        },
      },
      ["aggregate", "findings"],
    ),
  };
}

export function canonicalGitHubPollingSchemas() {
  const pollingStateProperties = {
    error: {
      oneOf: [{ $ref: "GitHubPollingError#" }, { type: "null" }],
    },
    forge_repository_id: { minimum: 1, type: "integer" },
    last_success_at: {
      oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
    },
    next_attempt_at: {
      oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
    },
    rate_gate_until: {
      oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
    },
  };
  const pollingStateRequired = [
    "baseline_status",
    "error",
    "forge_repository_id",
    "last_success_at",
    "next_attempt_at",
    "rate_gate_until",
  ];
  /** @param {"pending" | "complete" | "error"} status @param {Record<string, unknown>} properties */
  const pollingState = (status, properties) =>
    closedObject(
      {
        ...pollingStateProperties,
        ...properties,
        baseline_status: { const: status, type: "string" },
      },
      pollingStateRequired,
    );
  return {
    GitHubPollingError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    GitHubPollingFailure: closedObject(
      {
        error: { $ref: "GitHubPollingError#" },
        forge_repository_id: {
          oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
        },
        next_attempt_at: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
        rate_gate_until: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
      },
      ["error", "forge_repository_id", "next_attempt_at", "rate_gate_until"],
    ),
    GitHubPollingState: {
      oneOf: [
        pollingState("pending", {
          error: { type: "null" },
          last_success_at: { type: "null" },
          next_attempt_at: { minimum: 0, type: "integer" },
        }),
        pollingState("complete", {
          last_success_at: { minimum: 0, type: "integer" },
        }),
        pollingState("error", { error: { $ref: "GitHubPollingError#" } }),
      ],
    },
  };
}

export function canonicalGitHubConnectionSchemas() {
  const verificationProperties = {
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
      items: { $ref: "GitHubRepositoryVerificationCheck#" },
      minItems: 1,
      type: "array",
    },
    trigger: {
      enum: ["onboarding", "repository_selection", "enablement", "rotation"],
      type: "string",
    },
    verified_at: { minimum: 0, type: "integer" },
  };
  const verificationRequired = [
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
  ];
  /** @param {Record<string, unknown>} properties */
  const verification = (properties) =>
    closedObject(
      { ...verificationProperties, ...properties },
      verificationRequired,
    );
  const connectionProperties = {
    api_profile: { const: "github-rest:2026-03-10", type: "string" },
    app_id: { minimum: 1, type: "integer" },
    app_slug: { minLength: 1, type: "string" },
    capabilities: { $ref: "GitHubCapabilityEvidence#" },
    id: { minLength: 1, type: "string" },
    lifecycle: { enum: ["enabled", "retired"], type: "string" },
    permissions: { $ref: "GitHubPermissions#" },
    polling: { items: { $ref: "GitHubPollingState#" }, type: "array" },
    polling_failure: {
      oneOf: [{ $ref: "GitHubPollingFailure#" }, { type: "null" }],
    },
    principal: { $ref: "GitHubPrincipal#" },
    repository_count: { minimum: 1, type: "integer" },
    verification_history: {
      items: { $ref: "GitHubConnectionVerification#" },
      minItems: 1,
      type: "array",
    },
    verified_at: { minimum: 0, type: "integer" },
  };
  const connectionRequired = [
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
  ];
  /** @param {"healthy" | "error"} health @param {Record<string, unknown>} healthError */
  const connection = (health, healthError) =>
    closedObject(
      {
        ...connectionProperties,
        health: { const: health, type: "string" },
        health_error: healthError,
      },
      connectionRequired,
    );
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
      oneOf: [
        verification({
          api_profile: { const: "github-rest:2026-03-10", type: "string" },
          capabilities: { $ref: "GitHubCapabilityEvidence#" },
          error: { type: "null" },
          outcome: { const: "success", type: "string" },
          permissions: { $ref: "GitHubPermissions#" },
          principal: { $ref: "GitHubPrincipal#" },
          repositories: {
            items: { $ref: "GitHubRepositoryEvidence#" },
            minItems: 1,
            type: "array",
          },
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
        }),
        verification({
          error: { $ref: "GitHubVerificationError#" },
          outcome: { const: "error", type: "string" },
        }),
      ],
    },
    GitHubConnection: {
      oneOf: [
        connection("healthy", { type: "null" }),
        connection("error", { $ref: "GitHubConnectionHealthError#" }),
      ],
    },
    GitHubManifestStart: closedObject(
      {
        action: {
          pattern:
            "^https://github\\.com/settings/apps/new\\?state=[A-Za-z0-9_-]{8,256}$",
          type: "string",
        },
        manifest: { additionalProperties: true, type: "object" },
        method: { const: "POST", type: "string" },
        state: { minLength: 8, type: "string" },
      },
      ["action", "manifest", "method", "state"],
    ),
  };
}

export const forgejoRepositoryPermissions = {
  additionalProperties: false,
  properties: {
    admin: { const: true, type: "boolean" },
    pull: { const: true, type: "boolean" },
    push: { const: true, type: "boolean" },
  },
  required: ["admin", "pull", "push"],
  type: "object",
};

export const forgejoRepositorySuccessCheck = {
  additionalProperties: false,
  properties: {
    api_url: { format: "uri", type: "string" },
    clone_url: { format: "uri", type: "string" },
    full_name: { minLength: 1, type: "string" },
    html_url: { format: "uri", type: "string" },
    id: { minimum: 1, type: "integer" },
    outcome: { const: "success", type: "string" },
    permissions: forgejoRepositoryPermissions,
    private: { type: "boolean" },
  },
  required: [
    "api_url",
    "clone_url",
    "full_name",
    "html_url",
    "id",
    "outcome",
    "permissions",
    "private",
  ],
  type: "object",
};

export const forgejoRepositoryCheck = {
  oneOf: [
    forgejoRepositorySuccessCheck,
    {
      additionalProperties: false,
      properties: {
        forge_repository_id: { minimum: 1, type: "integer" },
        outcome: { const: "not_completed", type: "string" },
        permissions: forgejoRepositoryPermissions,
      },
      required: ["forge_repository_id", "outcome"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            code: { minLength: 1, type: "string" },
            message: { minLength: 1, type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
        forge_repository_id: { minimum: 1, type: "integer" },
        outcome: { const: "error", type: "string" },
        permissions: forgejoRepositoryPermissions,
      },
      required: ["error", "forge_repository_id", "outcome"],
      type: "object",
    },
  ],
};

const forgejoCodedError = {
  additionalProperties: false,
  properties: {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  required: ["code", "message"],
  type: "object",
};
const forgejoPrincipal = {
  additionalProperties: false,
  properties: {
    id: { minimum: 1, type: "integer" },
    login: { minLength: 1, type: "string" },
  },
  required: ["id", "login"],
  type: "object",
};
const forgejoVerificationRequired = [
  "api_profile",
  "capabilities",
  "error",
  "id",
  "outcome",
  "principal",
  "reported_version",
  "repositories",
  "scopes",
  "trigger",
  "verified_at",
];
const forgejoVerificationFacts = {
  id: { minLength: 1, type: "string" },
  trigger: { minLength: 1, type: "string" },
  verified_at: { type: "integer" },
};

export const forgejoSuccessfulVerification = {
  additionalProperties: false,
  properties: {
    ...forgejoVerificationFacts,
    api_profile: { const: "forgejo", type: "string" },
    capabilities: { additionalProperties: true, type: "object" },
    error: { type: "null" },
    outcome: { const: "success", type: "string" },
    principal: forgejoPrincipal,
    reported_version: { pattern: "^16\\.", type: "string" },
    repositories: { items: forgejoRepositorySuccessCheck, type: "array" },
    scopes: { items: { type: "string" }, type: "array" },
  },
  required: forgejoVerificationRequired,
  type: "object",
};

export const forgejoFailedVerification = {
  additionalProperties: false,
  properties: {
    ...forgejoVerificationFacts,
    api_profile: {
      oneOf: [{ const: "forgejo", type: "string" }, { type: "null" }],
    },
    capabilities: {
      oneOf: [{ additionalProperties: true, type: "object" }, { type: "null" }],
    },
    error: forgejoCodedError,
    outcome: { const: "error", type: "string" },
    principal: { oneOf: [forgejoPrincipal, { type: "null" }] },
    reported_version: {
      oneOf: [{ pattern: "^16\\.", type: "string" }, { type: "null" }],
    },
    repositories: { items: forgejoRepositoryCheck, type: "array" },
    scopes: {
      oneOf: [{ items: { type: "string" }, type: "array" }, { type: "null" }],
    },
  },
  required: forgejoVerificationRequired,
  type: "object",
};

export const forgejoPollingError = closedObject(
  {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  ["code", "message"],
);

export const forgejoPollingFailure = closedObject(
  {
    error: forgejoPollingError,
    forge_repository_id: {
      oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
    },
    next_attempt_at: {
      oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
    },
    rate_gate_until: {
      oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
    },
  },
  ["error", "forge_repository_id", "next_attempt_at", "rate_gate_until"],
);

const forgejoPollingStateProperties = {
  error: { oneOf: [forgejoPollingError, { type: "null" }] },
  forge_repository_id: { minimum: 1, type: "integer" },
  last_success_at: {
    oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
  },
  next_attempt_at: {
    oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
  },
  rate_gate_until: {
    oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
  },
};
const forgejoPollingStateRequired = [
  "baseline_status",
  "error",
  "forge_repository_id",
  "last_success_at",
  "next_attempt_at",
  "rate_gate_until",
];

/** @param {"pending" | "complete" | "error"} status @param {Record<string, unknown>} properties */
const forgejoPollingStateOf = (status, properties) =>
  closedObject(
    {
      ...forgejoPollingStateProperties,
      ...properties,
      baseline_status: { const: status, type: "string" },
    },
    forgejoPollingStateRequired,
  );

export const forgejoPollingState = {
  oneOf: [
    forgejoPollingStateOf("pending", {
      error: { type: "null" },
      next_attempt_at: { minimum: 0, type: "integer" },
    }),
    forgejoPollingStateOf("complete", {
      last_success_at: { minimum: 0, type: "integer" },
    }),
    forgejoPollingStateOf("error", { error: forgejoPollingError }),
  ],
};
