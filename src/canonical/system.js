import { closedObject, openObject } from "./schema.js";

const executionFailureDetail = {
  $ref: "CodexExecutionSystemFailureDetail#",
};
const executionRetryError = {
  anyOf: [executionFailureDetail, { type: "null" }],
};
const executionGate = { $ref: "CodexExecutionSystemGate#" };
const executionLease = { $ref: "CodexExecutionSystemLease#" };

/** @param {"queued" | "running"} executionStatus @param {Record<string, unknown>} resource */
function executionRow(executionStatus, resource) {
  const queued = executionStatus === "queued";
  return closedObject(
    {
      ...resource,
      execution_status: { const: executionStatus, type: "string" },
      gate: executionGate,
      lease: executionLease,
      ...(queued
        ? {
            next_attempt_at: {
              format: "date-time",
              type: ["string", "null"],
            },
            queue_position: { minimum: 1, type: "integer" },
          }
        : {}),
      pre_start_attempt_count: { minimum: 0, type: "integer" },
      retry_cycle: { minimum: 1, type: "integer" },
      retry_error: executionRetryError,
      retry_state: { enum: ["ready", "exhausted"], type: "string" },
    },
    [
      ...Object.keys(resource),
      "execution_status",
      ...(queued ? ["queue_position"] : []),
      "pre_start_attempt_count",
      "retry_cycle",
      "retry_state",
      "retry_error",
      ...(queued ? ["next_attempt_at"] : []),
      "lease",
      "gate",
    ],
  );
}

/** @param {"queued" | "running"} executionStatus */
function executionResourceRows(executionStatus) {
  return {
    oneOf: [
      executionRow(executionStatus, {
        evaluation_id: { type: "string" },
        review_run_id: { type: "string" },
      }),
      executionRow(executionStatus, {
        waiver_adjudication_id: { type: "string" },
      }),
    ],
  };
}

export function canonicalSystemExecutionSchemas() {
  return {
    CodexExecutionSystemFact: closedObject(
      {
        concurrency: {
          $ref: "CodexExecutionSystemConcurrency#",
        },
        failures: {
          items: {
            $ref: "CodexExecutionSystemFailure#",
          },
          type: "array",
        },
        queue: { $ref: "CodexExecutionSystemQueue#" },
        running: { $ref: "CodexExecutionSystemRunning#" },
      },
      ["concurrency", "queue", "running", "failures"],
    ),
    CodexExecutionSystemConcurrency: closedObject(
      {
        maximum_running: { maximum: 4, minimum: 1, type: "integer" },
        running_count: { minimum: 0, type: "integer" },
        start_gate: { enum: ["available", "no_new_start"], type: "string" },
      },
      ["maximum_running", "running_count", "start_gate"],
    ),
    CodexExecutionSystemQueue: closedObject(
      {
        count: { minimum: 0, type: "integer" },
        rows: {
          items: {
            $ref: "CodexExecutionSystemQueuedRow#",
          },
          type: "array",
        },
      },
      ["count", "rows"],
    ),
    CodexExecutionSystemRunning: closedObject(
      {
        count: { minimum: 0, type: "integer" },
        rows: {
          items: {
            $ref: "CodexExecutionSystemRunningRow#",
          },
          type: "array",
        },
      },
      ["count", "rows"],
    ),
    CodexExecutionSystemFailureDetail: closedObject(
      { code: { type: "string" }, detail: { type: "string" } },
      ["code", "detail"],
    ),
    CodexExecutionSystemGate: closedObject({ code: { type: "string" } }, [
      "code",
    ]),
    CodexExecutionSystemLease: closedObject(
      {
        expires_at: { format: "date-time", type: ["string", "null"] },
        fencing_token: { minimum: 0, type: "integer" },
        status: {
          enum: ["unclaimed", "held", "released", "stuck", "running"],
          type: "string",
        },
        worker_id: { type: ["string", "null"] },
      },
      ["expires_at", "fencing_token", "status", "worker_id"],
    ),
    CodexExecutionSystemQueuedRow: executionResourceRows("queued"),
    CodexExecutionSystemRunningRow: executionResourceRows("running"),
    CodexExecutionSystemFailure: {
      oneOf: [
        closedObject(
          {
            completed_at: { format: "date-time", type: "string" },
            error: executionFailureDetail,
            evaluation_id: { type: "string" },
            review_run_id: { type: "string" },
          },
          ["evaluation_id", "review_run_id", "completed_at", "error"],
        ),
        closedObject(
          {
            completed_at: { format: "date-time", type: "string" },
            error: executionFailureDetail,
            waiver_adjudication_id: { type: "string" },
          },
          ["waiver_adjudication_id", "completed_at", "error"],
        ),
      ],
    },
  };
}

export function canonicalCodexExecutionConcurrencySchemas() {
  return {
    CodexExecutionConcurrency: closedObject(
      {
        maximum_running: { maximum: 4, minimum: 1, type: "integer" },
      },
      ["maximum_running"],
    ),
  };
}

/**
 * @typedef {{
 *   codex_cli_version: string,
 *   models: ReadonlyArray<{
 *     id: string,
 *     reasoning_efforts: ReadonlyArray<string>,
 *     service_tiers: ReadonlyArray<string>
 *   }>
 * }} CodexCapabilityCatalog
 */

/** @param {CodexCapabilityCatalog} codexCapabilityCatalog */
export function canonicalSystemFactSchemas(codexCapabilityCatalog) {
  return {
    BootstrapFact: openObject(
      { status: { enum: ["complete", "required"], type: "string" } },
      ["status"],
    ),
    BrowserSessionsFact: openObject(
      {
        active_count: { minimum: 0, type: "integer" },
        status: { const: "available", type: "string" },
      },
      ["active_count", "status"],
    ),
    CodexFact: openObject(
      {
        catalog: { $ref: "CodexCapabilityCatalog#" },
        error: { type: "string" },
        status: { enum: ["available", "unavailable"], type: "string" },
      },
      ["catalog", "status"],
    ),
    CodexCapabilityCatalog: {
      ...closedObject(
        {
          codex_cli_version: {
            const: codexCapabilityCatalog.codex_cli_version,
            type: "string",
          },
          models: {
            items: { $ref: "CodexModelCapability#" },
            minItems: 1,
            type: "array",
          },
        },
        ["codex_cli_version", "models"],
      ),
      const: codexCapabilityCatalog,
    },
    CodexModelCapability: {
      oneOf: codexCapabilityCatalog.models.map((model) =>
        closedObject(
          {
            id: { const: model.id, type: "string" },
            reasoning_efforts: {
              items: { enum: model.reasoning_efforts, type: "string" },
              minItems: 1,
              type: "array",
            },
            service_tiers: {
              items: { enum: model.service_tiers, type: "string" },
              minItems: 1,
              type: "array",
            },
          },
          ["id", "reasoning_efforts", "service_tiers"],
        ),
      ),
    },
    DurableCoreFact: openObject(
      {
        database_version: { minLength: 1, type: "string" },
        foreign_keys: { const: true, type: "boolean" },
        integrity: { const: "ok", type: "string" },
        journal_mode: { const: "wal", type: "string" },
        status: { const: "ready", type: "string" },
        synchronous: { const: "full", type: "string" },
      },
      [
        "database_version",
        "foreign_keys",
        "integrity",
        "journal_mode",
        "status",
        "synchronous",
      ],
    ),
    ExecutionProviderError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
        recovery: { minLength: 1, type: "string" },
      },
      ["code", "message", "recovery"],
    ),
    ExecutionProviderFact: openObject(
      {
        error: { $ref: "ExecutionProviderError#" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
        status: { enum: ["available", "unavailable"], type: "string" },
      },
      ["id", "name", "status"],
    ),
    ImplementerTokenFact: openObject(
      { status: { enum: ["active", "revoked"], type: "string" } },
      ["status"],
    ),
  };
}

const pollingDeliveryError = { $ref: "SystemPollingDeliveryError#" };
const pollingDeliveryNullableError = {
  oneOf: [pollingDeliveryError, { type: "null" }],
};
const pollingDeliveryNullableTimestamp = {
  format: "date-time",
  type: ["string", "null"],
};
const pollingConnectionProperties = {
  connection_id: { minLength: 1, type: "string" },
  error: pollingDeliveryNullableError,
  health: { enum: ["healthy", "error"], type: "string" },
  health_error: pollingDeliveryNullableError,
  lifecycle: { enum: ["enabled", "retired"], type: "string" },
  next_attempt_at: pollingDeliveryNullableTimestamp,
  next_attempt_after_correction: { type: "boolean" },
  rate_gate_until: pollingDeliveryNullableTimestamp,
  repositories: {
    items: {
      $ref: "SystemPollingRepositoryFact#",
    },
    type: "array",
  },
};
const pollingConnectionRequired = [
  "connection_id",
  "error",
  "external_identity",
  "health",
  "health_error",
  "lifecycle",
  "next_attempt_at",
  "next_attempt_after_correction",
  "provider",
  "rate_gate_until",
  "repositories",
];

export function canonicalSystemPollingDeliverySchemas() {
  return {
    SystemPollingDeliveryError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    SystemGitHubPollingExternalIdentity: closedObject(
      {
        app_id: { minimum: 1, type: "integer" },
        app_slug: { minLength: 1, type: "string" },
        installation_id: { minimum: 1, type: "integer" },
        principal_id: { minimum: 1, type: "integer" },
        principal_login: { minLength: 1, type: "string" },
      },
      [
        "app_id",
        "app_slug",
        "installation_id",
        "principal_id",
        "principal_login",
      ],
    ),
    SystemForgejoPollingExternalIdentity: closedObject(
      {
        base_url: { format: "uri", minLength: 1, type: "string" },
        principal_id: { minimum: 1, type: "integer" },
        principal_login: { minLength: 1, type: "string" },
        reported_version: { minLength: 1, type: "string" },
      },
      ["base_url", "principal_id", "principal_login", "reported_version"],
    ),
    SystemPollingExternalIdentity: {
      oneOf: [
        { $ref: "SystemGitHubPollingExternalIdentity#" },
        { $ref: "SystemForgejoPollingExternalIdentity#" },
      ],
    },
    SystemPollingRepositoryFact: closedObject(
      {
        baseline_status: {
          enum: ["pending", "complete", "error"],
          type: "string",
        },
        error: pollingDeliveryNullableError,
        forge_repository_id: { minimum: 1, type: "integer" },
        health: { enum: ["healthy", "error"], type: "string" },
        health_error: pollingDeliveryNullableError,
        lifecycle: {
          enum: ["enabled", "disabled", "retired"],
          type: "string",
        },
        last_success_at: pollingDeliveryNullableTimestamp,
        name: { minLength: 1, type: "string" },
        next_attempt_at: pollingDeliveryNullableTimestamp,
        next_attempt_after_correction: { type: "boolean" },
        rate_gate_until: pollingDeliveryNullableTimestamp,
        repository_id: { minLength: 1, type: "string" },
      },
      [
        "baseline_status",
        "error",
        "forge_repository_id",
        "health",
        "health_error",
        "lifecycle",
        "last_success_at",
        "name",
        "next_attempt_at",
        "next_attempt_after_correction",
        "rate_gate_until",
        "repository_id",
      ],
    ),
    SystemGitHubPollingConnectionFact: closedObject(
      {
        ...pollingConnectionProperties,
        external_identity: {
          $ref: "SystemGitHubPollingExternalIdentity#",
        },
        provider: { const: "github", type: "string" },
      },
      pollingConnectionRequired,
    ),
    SystemForgejoPollingConnectionFact: closedObject(
      {
        ...pollingConnectionProperties,
        external_identity: {
          $ref: "SystemForgejoPollingExternalIdentity#",
        },
        provider: { const: "forgejo", type: "string" },
      },
      pollingConnectionRequired,
    ),
    SystemPollingConnectionFact: {
      oneOf: [
        { $ref: "SystemGitHubPollingConnectionFact#" },
        { $ref: "SystemForgejoPollingConnectionFact#" },
      ],
    },
    SystemPollingFact: closedObject(
      {
        connections: {
          items: {
            $ref: "SystemPollingConnectionFact#",
          },
          type: "array",
        },
      },
      ["connections"],
    ),
    SystemDeliverySurfaceFact: closedObject(
      {
        adjudication_id: { type: ["string", "null"] },
        attempt_count: { minimum: 0, type: "integer" },
        connection_id: { minLength: 1, type: "string" },
        decision_id: { type: ["string", "null"] },
        definitive: { type: "boolean" },
        error: pollingDeliveryNullableError,
        evaluation_id: { minLength: 1, type: "string" },
        external_id: { minimum: 1, type: ["integer", "null"] },
        finding_id: { type: ["string", "null"] },
        last_attempt_at: pollingDeliveryNullableTimestamp,
        next_attempt_at: pollingDeliveryNullableTimestamp,
        owner_kind: {
          enum: ["evaluation", "adjudication", "decision"],
          type: "string",
        },
        published_at: pollingDeliveryNullableTimestamp,
        provider: { enum: ["github", "forgejo"], type: "string" },
        provider_gate_error: pollingDeliveryNullableError,
        provider_gate_until: pollingDeliveryNullableTimestamp,
        publication_status: {
          enum: ["aggregate_only", "waiting", "succeeded", "unavailable"],
          type: "string",
        },
        reconciliation_required: { type: "boolean" },
        repository_id: { minLength: 1, type: "string" },
        source_identity: { minLength: 1, type: "string" },
        status: {
          enum: [
            "aggregate_only",
            "waiting",
            "retry_scheduled",
            "reconciling",
            "succeeded",
            "unavailable",
          ],
          type: "string",
        },
        surface: {
          enum: ["commit_status", "aggregate_feedback", "inline_feedback"],
          type: "string",
        },
        target: { type: ["string", "null"] },
      },
      [
        "adjudication_id",
        "attempt_count",
        "connection_id",
        "decision_id",
        "definitive",
        "error",
        "evaluation_id",
        "external_id",
        "finding_id",
        "last_attempt_at",
        "next_attempt_at",
        "owner_kind",
        "published_at",
        "provider",
        "provider_gate_error",
        "provider_gate_until",
        "publication_status",
        "reconciliation_required",
        "repository_id",
        "source_identity",
        "status",
        "surface",
        "target",
      ],
    ),
    SystemDeliveryFact: closedObject(
      {
        surfaces: {
          items: {
            $ref: "SystemDeliverySurfaceFact#",
          },
          type: "array",
        },
      },
      ["surfaces"],
    ),
  };
}

const storageError = { $ref: "SystemStorageError#" };
const storageNullableError = { oneOf: [storageError, { type: "null" }] };
const storageNullableTimestamp = {
  format: "date-time",
  type: ["string", "null"],
};

export function canonicalSystemStorageSchemas() {
  return {
    SystemStorageError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    SystemApplicationFact: closedObject(
      {
        application_version: { type: ["string", "null"] },
        error: storageNullableError,
        installation_key_identity: {
          pattern: "^sha256:[0-9a-f]{64}$",
          type: ["string", "null"],
        },
        status: { enum: ["available", "unavailable"], type: "string" },
      },
      ["application_version", "error", "installation_key_identity", "status"],
    ),
    SystemBackupRecord: closedObject(
      {
        application_version: {
          pattern: "^\\d+\\.\\d+\\.\\d+$",
          type: "string",
        },
        created_at: { format: "date-time", type: "string" },
        installation_key_identity: {
          pattern: "^sha256:[0-9a-f]{64}$",
          type: "string",
        },
        kind: { const: "daily", type: "string" },
      },
      [
        "application_version",
        "created_at",
        "installation_key_identity",
        "kind",
      ],
    ),
    SystemBackupFact: closedObject(
      {
        error: storageNullableError,
        last_successful: {
          oneOf: [{ $ref: "SystemBackupRecord#" }, { type: "null" }],
        },
        status: {
          enum: ["current", "empty", "stale", "unavailable"],
          type: "string",
        },
      },
      ["error", "last_successful", "status"],
    ),
    SystemStorageCleanupFact: closedObject(
      {
        artifacts_removed: { minimum: 0, type: ["integer", "null"] },
        error: storageNullableError,
        last_run_at: storageNullableTimestamp,
        sessions_removed: { minimum: 0, type: ["integer", "null"] },
        status: {
          enum: ["available", "not_run", "running", "unavailable"],
          type: "string",
        },
      },
      [
        "artifacts_removed",
        "error",
        "last_run_at",
        "sessions_removed",
        "status",
      ],
    ),
  };
}

export function canonicalStorageReserveSchemas() {
  return {
    StorageReserveFact: closedObject(
      {
        cleanup: {
          $ref: "SystemStorageCleanupFact#",
        },
        filesystems: {
          items: {
            $ref: "StorageReserveFilesystemFact#",
          },
          maxItems: 2,
          minItems: 2,
          type: "array",
        },
        reserve_bytes: { minimum: 1, type: "integer" },
        status: {
          enum: ["available", "unavailable"],
          type: "string",
        },
      },
      ["cleanup", "filesystems", "reserve_bytes", "status"],
    ),
    StorageReserveFilesystemFact: closedObject(
      {
        available_bytes: { minimum: 0, type: "integer" },
        filesystem: {
          enum: ["state", "checkouts"],
          type: "string",
        },
        path: { minLength: 1, type: "string" },
        status: {
          enum: ["available", "unavailable"],
          type: "string",
        },
      },
      ["available_bytes", "filesystem", "path", "status"],
    ),
  };
}

export function canonicalRepositorySchemas() {
  const credentialString = { minLength: 1, type: "string" };
  const repositoryBaseProperties = {
    deletion_eligible: { type: "boolean" },
    health: { enum: ["healthy", "error"], type: "string" },
    health_error: {
      oneOf: [{ $ref: "RepositoryHealthError#" }, { type: "null" }],
    },
    id: { minLength: 1, type: "string" },
    lifecycle: {
      enum: ["enabled", "disabled", "retired"],
      type: "string",
    },
    url: { format: "uri", pattern: "^https://", type: "string" },
  };
  const repositoryBaseRequired = [
    "credential_type",
    "deletion_eligible",
    "health",
    "health_error",
    "id",
    "lifecycle",
    "url",
  ];
  /** @param {Record<string, unknown>} properties @param {string[]} required */
  const repositoryObject = (properties, required) => ({
    oneOf: [
      closedObject(
        {
          ...properties,
          health: { const: "healthy", type: "string" },
          health_error: { type: "null" },
        },
        required,
      ),
      closedObject(
        {
          ...properties,
          health: { const: "error", type: "string" },
          health_error: { $ref: "RepositoryHealthError#" },
        },
        required,
      ),
    ],
  });
  return {
    RepositoryGuidanceApplicability: {
      oneOf: [
        closedObject({ type: { const: "unconditional", type: "string" } }, [
          "type",
        ]),
        closedObject(
          {
            expression: { minLength: 1, type: "string" },
            profile: {
              const: "quality-bar-restricted-cel-v1",
              type: "string",
            },
            type: { const: "conditional", type: "string" },
          },
          ["type", "expression", "profile"],
        ),
      ],
    },
    RepositoryGuidanceAssignment: closedObject(
      {
        scope: {
          enum: ["installation_wide", "repository_specific"],
          type: "string",
        },
      },
      ["scope"],
    ),
    RepositoryGuidanceCriterion: closedObject(
      {
        id: { minLength: 1, type: "string" },
        impact: { enum: ["advisory", "blocking"], type: "string" },
        instruction: { minLength: 1, type: "string" },
      },
      ["id", "instruction", "impact"],
    ),
    RepositoryGuidanceReview: closedObject(
      {
        active_version: closedObject(
          {
            id: { minLength: 1, type: "string" },
            number: { minimum: 1, type: "integer" },
          },
          ["id", "number"],
        ),
        applicability: {
          $ref: "RepositoryGuidanceApplicability#",
        },
        assignment: {
          $ref: "RepositoryGuidanceAssignment#",
        },
        criteria: {
          items: {
            $ref: "RepositoryGuidanceCriterion#",
          },
          minItems: 1,
          type: "array",
        },
        description: { minLength: 1, type: "string" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
      },
      [
        "id",
        "name",
        "description",
        "active_version",
        "assignment",
        "applicability",
        "criteria",
      ],
    ),
    RepositoryGuidance: closedObject(
      {
        guidance_revision: {
          pattern: "^guidance-v1-[A-Za-z0-9_-]{43}$",
          type: "string",
        },
        repository: closedObject(
          {
            id: { minLength: 1, type: "string" },
            url: { format: "uri", pattern: "^https://", type: "string" },
          },
          ["id", "url"],
        ),
        reviews: {
          items: { $ref: "RepositoryGuidanceReview#" },
          type: "array",
        },
        schema_version: { const: 1, type: "integer" },
      },
      ["schema_version", "guidance_revision", "repository", "reviews"],
    ),
    GenericRepositoryRegistrationRequest: {
      oneOf: [
        closedObject(
          {
            url: {
              format: "uri",
              pattern: "^[hH][tT][tT][pP][sS]://",
              type: "string",
            },
          },
          ["url"],
        ),
        closedObject(
          {
            token: credentialString,
            url: {
              format: "uri",
              pattern: "^[hH][tT][tT][pP][sS]://",
              type: "string",
            },
            username: credentialString,
          },
          ["token", "url", "username"],
        ),
      ],
    },
    GenericRepositoryCredentialRotationRequest: closedObject(
      { token: credentialString, username: credentialString },
      ["token", "username"],
    ),
    RepositoryLifecycleRequest: closedObject(
      {
        lifecycle: {
          enum: ["enabled", "disabled", "retired"],
          type: "string",
        },
      },
      ["lifecycle"],
    ),
    RepositoryHealthError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    Repository: {
      oneOf: [
        repositoryObject(
          {
            ...repositoryBaseProperties,
            credential_type: {
              enum: ["none", "username_token"],
              type: "string",
            },
          },
          repositoryBaseRequired,
        ),
        repositoryObject(
          {
            ...repositoryBaseProperties,
            api_url: { format: "uri", type: "string" },
            assignment_count: { minimum: 0, type: "integer" },
            credential_type: {
              const: "forge_connection",
              type: "string",
            },
            forge_connection_id: { minLength: 1, type: "string" },
            forge_repository_id: { minimum: 1, type: "integer" },
            name: { minLength: 1, type: "string" },
            provider: { enum: ["github", "forgejo"], type: "string" },
            verification_id: { minLength: 1, type: "string" },
            verified_at: { minimum: 0, type: "integer" },
            web_url: { format: "uri", type: "string" },
          },
          [
            ...repositoryBaseRequired,
            "api_url",
            "assignment_count",
            "forge_connection_id",
            "forge_repository_id",
            "name",
            "provider",
            "verification_id",
            "verified_at",
            "web_url",
          ],
        ),
      ],
    },
    RepositoryCollection: closedObject(
      {
        items: {
          items: { $ref: "Repository#" },
          type: "array",
        },
        next_cursor: { type: ["string", "null"] },
      },
      ["items", "next_cursor"],
    ),
  };
}
