/**
 * @param {Record<string, unknown>} properties
 * @param {string[]} required
 */
function closedObject(properties, required) {
  return { additionalProperties: false, properties, required, type: "object" };
}

export function canonicalRepositorySchemas() {
  const credentialString = { minLength: 1, type: "string" };
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
          $ref: "#/components/schemas/RepositoryGuidanceApplicability",
        },
        assignment: {
          $ref: "#/components/schemas/RepositoryGuidanceAssignment",
        },
        criteria: {
          items: {
            $ref: "#/components/schemas/RepositoryGuidanceCriterion",
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
          items: { $ref: "#/components/schemas/RepositoryGuidanceReview" },
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
      { lifecycle: { enum: ["enabled", "disabled"], type: "string" } },
      ["lifecycle"],
    ),
    RepositoryHealthError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    Repository: closedObject(
      {
        credential_type: {
          enum: ["none", "username_token"],
          type: "string",
        },
        health: { enum: ["healthy", "error"], type: "string" },
        health_error: {
          oneOf: [
            { $ref: "#/components/schemas/RepositoryHealthError" },
            { type: "null" },
          ],
        },
        id: { minLength: 1, type: "string" },
        lifecycle: {
          enum: ["enabled", "disabled", "retired"],
          type: "string",
        },
        url: { format: "uri", pattern: "^https://", type: "string" },
      },
      ["credential_type", "health", "health_error", "id", "lifecycle", "url"],
    ),
  };
}
