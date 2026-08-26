export class EvaluationError extends Error {
  name: "EvaluationError";
  code: string;
  unavailable?: true;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & { unavailable?: boolean },
  ) {
    super(message, options);
    this.name = "EvaluationError";
    this.code = code;
    if (options?.unavailable === true) {
      this.unavailable = true;
    }
  }
}

export function failEvaluation(
  code: string,
  message: string,
  cause?: unknown,
): never {
  throw new EvaluationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function failEvaluationUnavailable(
  code: string,
  message: string,
): never {
  throw new EvaluationError(code, message, { unavailable: true });
}

function canonicalSelector(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failEvaluation(
      "evaluation_selector_invalid",
      `${name} selector is invalid`,
    );
  }
  const selector = value as Record<string, unknown>;
  if (
    Object.keys(selector).sort().join(",") !== "type,value" ||
    !["branch", "commit"].includes(selector.type as string) ||
    typeof selector.value !== "string"
  ) {
    failEvaluation(
      "evaluation_selector_invalid",
      `${name} selector is invalid`,
    );
  }
  const selectorValue = selector.value as string;
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

export function canonicalExplicitEvaluationRequest(request: unknown) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    failEvaluation(
      "evaluation_request_invalid",
      "Evaluation request is invalid",
    );
  }
  const value = request as Record<string, unknown>;
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

export function requireIdempotencyKey(value: unknown) {
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
