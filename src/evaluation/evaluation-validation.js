export class EvaluationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {unavailable?: boolean}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "EvaluationError";
    this.code = code;
    if (options?.unavailable === true) {
      this.unavailable = true;
    }
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
export function failEvaluation(code, message, cause) {
  throw new EvaluationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
export function failEvaluationUnavailable(code, message) {
  throw new EvaluationError(code, message, { unavailable: true });
}

/** @param {unknown} value @param {string} name */
function canonicalSelector(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failEvaluation(
      "evaluation_selector_invalid",
      `${name} selector is invalid`,
    );
  }
  const selector = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(selector).sort().join(",") !== "type,value" ||
    !["branch", "commit"].includes(/** @type {string} */ (selector.type)) ||
    typeof selector.value !== "string"
  ) {
    failEvaluation(
      "evaluation_selector_invalid",
      `${name} selector is invalid`,
    );
  }
  const selectorValue = /** @type {string} */ (selector.value);
  if (selector.type === "commit") {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(selectorValue)) {
      failEvaluation(
        "evaluation_selector_invalid",
        `${name} commit selector must be a full object ID`,
      );
    }
    return { type: "commit", value: selectorValue.toLowerCase() };
  }
  const branch = selectorValue;
  if (
    branch.length === 0 ||
    branch === "@" ||
    branch.startsWith(".") ||
    branch.startsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    /[\0-\x20\x7f~^:?*[\\]/.test(branch) ||
    branch
      .split("/")
      .some(
        (component) => component.startsWith(".") || component.endsWith(".lock"),
      )
  ) {
    failEvaluation(
      "evaluation_selector_invalid",
      `${name} branch selector is invalid`,
    );
  }
  return { type: "branch", value: branch };
}

/** @param {unknown} request */
export function canonicalExplicitEvaluationRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    failEvaluation(
      "evaluation_request_invalid",
      "Evaluation request is invalid",
    );
  }
  const value = /** @type {Record<string, unknown>} */ (request);
  if (Object.keys(value).sort().join(",") !== "base,head") {
    failEvaluation(
      "evaluation_request_invalid",
      "Evaluation request is invalid",
    );
  }
  return {
    base: canonicalSelector(value.base, "Base"),
    head: canonicalSelector(value.head, "Head"),
  };
}

/** @param {unknown} value */
export function requireIdempotencyKey(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /[^\x21-\x7e]/.test(value)
  ) {
    failEvaluation(
      "idempotency_key_required",
      "A valid Idempotency-Key header is required",
    );
  }
  return value;
}
