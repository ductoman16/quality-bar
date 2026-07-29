import { isMcpRecord } from "./mcp-message.js";
import { isClosedMcpRecord, mcpError } from "./mcp-validation.js";

/** @param {unknown} value */
function evaluationSelector(value) {
  if (!isMcpRecord(value)) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  if (
    value.type === "branch" &&
    isClosedMcpRecord(value, new Set(["type", "name"])) &&
    typeof value.name === "string" &&
    value.name.length > 0
  ) {
    return { type: "branch", value: value.name };
  }
  if (
    value.type === "commit" &&
    isClosedMcpRecord(value, new Set(["type", "object_id"])) &&
    typeof value.object_id === "string" &&
    /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value.object_id)
  ) {
    return { type: "commit", value: value.object_id };
  }
  throw mcpError("request_malformed", "Request is malformed");
}

/** @param {unknown} arguments_ */
export function requestEvaluationArguments(arguments_) {
  if (
    !isClosedMcpRecord(
      arguments_,
      new Set([
        "repository_id",
        "base_selector",
        "head_selector",
        "idempotency_key",
      ]),
    ) ||
    Object.keys(arguments_).length !== 4 ||
    typeof arguments_.repository_id !== "string" ||
    arguments_.repository_id.length === 0 ||
    typeof arguments_.idempotency_key !== "string" ||
    arguments_.idempotency_key.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return {
    idempotencyKey: arguments_.idempotency_key,
    repositoryId: arguments_.repository_id,
    request: {
      base: evaluationSelector(arguments_.base_selector),
      head: evaluationSelector(arguments_.head_selector),
    },
  };
}

/** @param {unknown} arguments_ */
export function evaluationArguments(arguments_) {
  if (
    !isClosedMcpRecord(arguments_, new Set(["evaluation_id"])) ||
    Object.keys(arguments_).length !== 1 ||
    typeof arguments_.evaluation_id !== "string" ||
    arguments_.evaluation_id.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return { evaluationId: arguments_.evaluation_id };
}

/** @param {string} evaluationId */
function evaluationUri(evaluationId) {
  return `quality-bar://v1/evaluations/${encodeURIComponent(evaluationId)}`;
}

/** @param {string} evaluationId @param {boolean} [result] */
function evaluationLink(evaluationId, result = false) {
  return {
    mimeType: "application/json",
    name: result ? `${evaluationId} Result` : evaluationId,
    type: "resource_link",
    uri: `${evaluationUri(evaluationId)}${result ? "/result" : ""}`,
  };
}

/** @param {string} kind @param {string} id */
function resourceLink(kind, id) {
  return {
    mimeType: "application/json",
    name: id,
    type: "resource_link",
    uri: `quality-bar://v1/${kind}/${encodeURIComponent(id)}`,
  };
}

/** @param {string} evaluationId */
export function evaluationResourceLinks(evaluationId) {
  return [evaluationLink(evaluationId), evaluationLink(evaluationId, true)];
}

/**
 * @param {ReturnType<ReturnType<typeof import("./evaluation.js").createEvaluationService>["readResult"]>} document
 */
export function resultChildResourceLinks(document) {
  return [
    ...document.review_runs.map(({ id }) => {
      if (typeof id !== "string") {
        throw new TypeError("Review Run identity is invalid");
      }
      return resourceLink("review-runs", id);
    }),
    ...document.findings.map(({ id }) => {
      if (typeof id !== "string") {
        throw new TypeError("Finding identity is invalid");
      }
      return resourceLink("findings", id);
    }),
  ];
}

/**
 * @param {ReturnType<typeof import("./evaluation.js").createEvaluationService>} evaluations
 * @param {string} evaluationId
 */
function readEvaluationResult(evaluations, evaluationId) {
  try {
    return evaluations.readResult(evaluationId);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "evaluation_result_not_ready"
    ) {
      throw mcpError("not_ready", error.message);
    }
    throw error;
  }
}

/**
 * @param {string} name
 * @param {unknown} arguments_
 * @param {ReturnType<typeof import("./evaluation.js").createEvaluationService>} evaluations
 */
export async function executeEvaluationTool(name, arguments_, evaluations) {
  if (name === "quality_bar.request_evaluation") {
    const input = requestEvaluationArguments(arguments_);
    const created = await evaluations.createExplicit({
      channel: "mcp",
      ...input,
    });
    return {
      document: created.resource,
      links: evaluationResourceLinks(created.resource.id),
      resourceIds: [input.repositoryId, created.resource.id],
    };
  }
  const { evaluationId } = evaluationArguments(arguments_);
  if (name === "quality_bar.get_evaluation") {
    return {
      document: evaluations.read(evaluationId),
      links: evaluationResourceLinks(evaluationId),
      resourceIds: [evaluationId],
    };
  }
  if (name !== "quality_bar.get_evaluation_result") {
    throw mcpError("request_malformed", "Unknown Evaluation tool");
  }
  const document = readEvaluationResult(evaluations, evaluationId);
  return {
    document,
    links: [
      ...evaluationResourceLinks(evaluationId),
      ...resultChildResourceLinks(document),
    ],
    resourceIds: [evaluationId],
  };
}

/** @param {string} uri */
export function matchWorkflowResource(uri) {
  const match =
    /^quality-bar:\/\/v1\/(repositories|evaluations|review-runs|findings|waiver-requests|waiver-adjudications|waiver-decisions)\/([^/]+)(\/(?:guidance|result))?$/.exec(
      uri,
    );
  if (!match) {
    return null;
  }
  try {
    const result = {
      id: decodeURIComponent(match[2]),
      kind: match[1],
      suffix: match[3],
    };
    const suffixIsValid =
      (result.kind === "repositories" &&
        [undefined, "/guidance"].includes(result.suffix)) ||
      (result.kind === "evaluations" &&
        [undefined, "/result"].includes(result.suffix)) ||
      (result.kind !== "repositories" &&
        result.kind !== "evaluations" &&
        result.suffix === undefined);
    return suffixIsValid ? result : null;
  } catch {
    return null;
  }
}

/**
 * @param {NonNullable<ReturnType<typeof matchWorkflowResource>>} match
 * @param {{
 *   evaluations: ReturnType<typeof import("./evaluation.js").createEvaluationService>,
 *   repositories: Omit<ReturnType<typeof import("./repository.js").createRepositoryService>, "resolvePushedSelectors">,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>
 * }} dependencies
 */
export function readWorkflowResource(
  match,
  { evaluations, repositories, repositoryGuidance },
) {
  if (match.kind === "repositories") {
    const document =
      match.suffix === "/guidance"
        ? repositoryGuidance.read(match.id)
        : repositories.list().find(({ id }) => id === match.id);
    if (!document) {
      throw mcpError("repository_not_found", "Resource was not found");
    }
    return document;
  }
  if (match.kind === "evaluations") {
    return match.suffix === "/result"
      ? readEvaluationResult(evaluations, match.id)
      : evaluations.read(match.id);
  }
  if (match.kind === "review-runs") {
    return evaluations.readReviewRunById(match.id);
  }
  if (match.kind === "findings") {
    return evaluations.readFindingById(match.id);
  }
  throw mcpError(
    `${match.kind.replaceAll("-", "_").replace(/s$/, "")}_not_found`,
    "Resource was not found",
  );
}
