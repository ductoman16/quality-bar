import { isMcpRecord } from "./mcp-message.ts";
import { mcpResourceLink } from "./mcp-resource-link.ts";
import { isClosedMcpRecord, mcpError } from "./mcp-validation.ts";

function evaluationSelector(value: unknown) {
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

export function requestEvaluationArguments(arguments_: unknown) {
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

export function evaluationArguments(arguments_: unknown) {
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

function evaluationUri(evaluationId: string) {
  return `quality-bar://v1/evaluations/${encodeURIComponent(evaluationId)}`;
}

function evaluationLink(evaluationId: string, result: boolean = false) {
  return {
    mimeType: "application/json",
    name: result ? `${evaluationId} Result` : evaluationId,
    type: "resource_link",
    uri: `${evaluationUri(evaluationId)}${result ? "/result" : ""}`,
  };
}

export function evaluationResourceLinks(evaluationId: string) {
  return [evaluationLink(evaluationId), evaluationLink(evaluationId, true)];
}

export function resultChildResourceLinks(
  document: ReturnType<
    ReturnType<
      typeof import("../evaluation/evaluation.ts").createEvaluationService
    >["readResult"]
  >,
) {
  return [
    ...document.review_runs.map(({ id }) => {
      if (typeof id !== "string") {
        throw new TypeError("Review Run identity is invalid");
      }
      return mcpResourceLink("review-runs", id);
    }),
    ...document.findings.map(({ id }) => {
      if (typeof id !== "string") {
        throw new TypeError("Finding identity is invalid");
      }
      return mcpResourceLink("findings", id);
    }),
  ];
}

function readEvaluationResult(
  evaluations: ReturnType<
    typeof import("../evaluation/evaluation.ts").createEvaluationService
  >,
  evaluationId: string,
) {
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

export async function executeEvaluationTool(
  name: string,
  arguments_: unknown,
  evaluations: ReturnType<
    typeof import("../evaluation/evaluation.ts").createEvaluationService
  >,
) {
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

export function matchWorkflowResource(uri: string) {
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

export function readWorkflowResource(
  match: NonNullable<ReturnType<typeof matchWorkflowResource>>,
  {
    evaluations,
    repositories,
    repositoryGuidance,
  }: {
    evaluations: ReturnType<
      typeof import("../evaluation/evaluation.ts").createEvaluationService
    >;
    repositories: Omit<
      ReturnType<
        typeof import("../repository/repository.ts").createRepositoryService
      >,
      "resolvePushedSelectors" | "resolvePullRequestChangeset"
    >;
    repositoryGuidance: ReturnType<
      typeof import("../repository/repository-guidance.ts").createRepositoryGuidanceService
    >;
  },
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
  if (match.kind === "waiver-requests") {
    return evaluations.readWaiverRequest(match.id);
  }
  if (match.kind === "waiver-adjudications") {
    return evaluations.readWaiverAdjudication(match.id);
  }
  if (match.kind === "waiver-decisions") {
    return evaluations.readWaiverDecision(match.id);
  }
  throw mcpError(
    `${match.kind.replaceAll("-", "_").replace(/s$/, "")}_not_found`,
    "Resource was not found",
  );
}
