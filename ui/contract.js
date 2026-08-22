/** @param {unknown} value @returns {value is Record<string, any>} */
export const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
export const nonempty = (value) =>
  typeof value === "string" && value.length > 0;

/** @param {unknown} value */
export const count = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** @param {unknown} value @param {string[]} names */
export const exact = (value, names) =>
  record(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));

/** @param {any} value */
export const requiredTimestamp = (value) =>
  nonempty(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

/** @param {unknown} value */
export const timestamp = (value) => value === null || requiredTimestamp(value);

/** @param {any} value @param {string} prefix */
export const numberedId = (value, prefix) =>
  nonempty(value) && new RegExp(`^${prefix}-[1-9][0-9]*$`).test(value);

/** @param {any} value */
export const httpsUrl = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** @param {any} value */
export const uri = (value) => {
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
/** @param {unknown} value */
const safeDestination = (value) => {
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
/** @param {unknown} value */
export const validBrowserConfiguration = (value) =>
  record(value) &&
  views.includes(value.view) &&
  (value.authenticated === true
    ? exact(value, ["authenticated", "csrfCookieName", "view"]) &&
      nonempty(value.csrfCookieName) &&
      /^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    : value.authenticated === false &&
      exact(value, ["authenticated", "intendedDestination", "view"]) &&
      safeDestination(value.intendedDestination));

/** @param {unknown} value */
export const nullableString = (value) => value === null || nonempty(value);

/** @param {any} value */
export const errorFact = (value) =>
  value === null ||
  (record(value) &&
    nonempty(value.code) &&
    nonempty(value.message ?? value.detail));

/** @param {any} value */
export const modelCapability = (value) =>
  record(value) &&
  nonempty(value.id) &&
  Array.isArray(value.reasoning_efforts) &&
  value.reasoning_efforts.length > 0 &&
  value.reasoning_efforts.every(nonempty) &&
  Array.isArray(value.service_tiers) &&
  value.service_tiers.length > 0 &&
  value.service_tiers.every(nonempty);

/** @param {any} value */
export const validTokenReveal = (value) =>
  record(value) &&
  exact(value, ["token"]) &&
  nonempty(value.token) &&
  /^[A-Za-z0-9_-]{43}$/.test(value.token);

/** @param {any} value */
export const validOnboardingToken = (value) =>
  record(value) &&
  exact(value, ["created_at", "expires_at", "id", "repository_url"]) &&
  nonempty(value.id) &&
  uri(value.repository_url) &&
  count(value.created_at) &&
  count(value.expires_at);

/** @param {any} value */
export const validOnboardingTokenReveal = (value) =>
  record(value) &&
  exact(value, ["created_at", "expires_at", "id", "repository_url", "token"]) &&
  nonempty(value.id) &&
  uri(value.repository_url) &&
  count(value.created_at) &&
  count(value.expires_at) &&
  typeof value.token === "string" &&
  value.token.length === 43;

/** @param {any} value */
export function readOnboardingTokens(value) {
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
