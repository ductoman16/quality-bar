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
const verificationRequired = [
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
const verificationFacts = {
  id: { minLength: 1, type: "string" },
  trigger: { minLength: 1, type: "string" },
  verified_at: { type: "integer" },
};

export const forgejoSuccessfulVerification = {
  additionalProperties: false,
  properties: {
    ...verificationFacts,
    api_profile: { const: "forgejo", type: "string" },
    capabilities: { additionalProperties: true, type: "object" },
    error: { type: "null" },
    outcome: { const: "success", type: "string" },
    principal: forgejoPrincipal,
    reported_version: { pattern: "^16\\.", type: "string" },
    repositories: { items: forgejoRepositorySuccessCheck, type: "array" },
    scopes: { items: { type: "string" }, type: "array" },
  },
  required: verificationRequired,
  type: "object",
};

export const forgejoFailedVerification = {
  additionalProperties: false,
  properties: {
    ...verificationFacts,
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
  required: verificationRequired,
  type: "object",
};
