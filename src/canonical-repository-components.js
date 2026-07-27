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
