/**
 * @param {Record<string, unknown>} properties
 * @param {string[]} required
 */
function closedObject(properties, required) {
  return { additionalProperties: false, properties, required, type: "object" };
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
