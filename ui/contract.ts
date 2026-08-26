export const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const nonempty = (value: unknown) =>
  typeof value === "string" && value.length > 0;

export const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const exact = (value: unknown, names: string[]) =>
  record(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));

export const requiredTimestamp = (value: any) =>
  nonempty(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export const timestamp = (value: unknown) =>
  value === null || requiredTimestamp(value);

export const numberedId = (value: any, prefix: string) =>
  nonempty(value) && new RegExp(`^${prefix}-[1-9][0-9]*$`).test(value);

export const httpsUrl = (value: any) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const uri = (value: any) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
};

const views = [
  "analytics",
  "evaluation-detail",
  "evaluations",
  "repositories",
  "repository-detail",
  "review-detail",
  "reviews",
  "system",
];
const safeDestination = (value: unknown) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return (
      value.length > 0 &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      new URL(value, "http://quality-bar.internal").origin ===
        "http://quality-bar.internal"
    );
  } catch {
    return false;
  }
};
export const validBrowserConfiguration = (value: unknown) =>
  record(value) &&
  views.includes(value.view) &&
  (value.authenticated === true
    ? exact(value, ["authenticated", "csrfCookieName", "view"]) &&
      nonempty(value.csrfCookieName) &&
      /^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    : value.authenticated === false &&
      exact(value, ["authenticated", "intendedDestination", "view"]) &&
      safeDestination(value.intendedDestination));

export const nullableString = (value: unknown) =>
  value === null || nonempty(value);

export const errorFact = (value: any) =>
  value === null ||
  (record(value) &&
    nonempty(value.code) &&
    nonempty(value.message ?? value.detail));

export const modelCapability = (value: any) =>
  record(value) &&
  nonempty(value.id) &&
  Array.isArray(value.reasoning_efforts) &&
  value.reasoning_efforts.length > 0 &&
  value.reasoning_efforts.every(nonempty) &&
  Array.isArray(value.service_tiers) &&
  value.service_tiers.length > 0 &&
  value.service_tiers.every(nonempty);

export const validTokenReveal = (value: any) =>
  record(value) &&
  exact(value, ["token"]) &&
  nonempty(value.token) &&
  /^[A-Za-z0-9_-]{43}$/.test(value.token);

export const validOnboardingToken = (value: any) =>
  record(value) &&
  exact(value, ["created_at", "expires_at", "id", "repository_url"]) &&
  nonempty(value.id) &&
  uri(value.repository_url) &&
  count(value.created_at) &&
  count(value.expires_at);

export const validOnboardingTokenReveal = (value: any) =>
  record(value) &&
  exact(value, ["created_at", "expires_at", "id", "repository_url", "token"]) &&
  nonempty(value.id) &&
  uri(value.repository_url) &&
  count(value.created_at) &&
  count(value.expires_at) &&
  typeof value.token === "string" &&
  value.token.length === 43;

export function readOnboardingTokens(value: any) {
  if (
    !record(value) ||
    !exact(value, ["onboarding_tokens"]) ||
    !Array.isArray(value.onboarding_tokens) ||
    !value.onboarding_tokens.every(validOnboardingToken)
  ) {
    throw new Error("onboarding_token_collection_invalid");
  }
  return value.onboarding_tokens;
}
