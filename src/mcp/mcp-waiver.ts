import { mcpResourceLink } from "./mcp-resource-link.ts";
import { isClosedMcpRecord, mcpError } from "./mcp-validation.ts";

export function submitWaiverArguments(arguments_: unknown) {
  if (
    !isClosedMcpRecord(
      arguments_,
      new Set(["evaluation_id", "requests", "idempotency_key"]),
    ) ||
    Object.keys(arguments_).length !== 3 ||
    typeof arguments_.evaluation_id !== "string" ||
    arguments_.evaluation_id.length === 0 ||
    typeof arguments_.idempotency_key !== "string" ||
    arguments_.idempotency_key.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return {
    evaluationId: arguments_.evaluation_id,
    idempotencyKey: arguments_.idempotency_key,
    request: { requests: arguments_.requests },
  };
}

export function waiverAdjudicationArguments(arguments_: unknown) {
  if (
    !isClosedMcpRecord(arguments_, new Set(["waiver_adjudication_id"])) ||
    Object.keys(arguments_).length !== 1 ||
    typeof arguments_.waiver_adjudication_id !== "string" ||
    arguments_.waiver_adjudication_id.length === 0
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return { adjudicationId: arguments_.waiver_adjudication_id };
}

export function executeWaiverTool(
  name: string,
  arguments_: unknown,
  evaluations: ReturnType<
    typeof import("../evaluation/evaluation.ts").createEvaluationService
  >,
) {
  if (name === "quality_bar.submit_waiver_requests") {
    const input = submitWaiverArguments(arguments_);
    const created = evaluations.submitWaiverBatch({
      channel: "mcp",
      ...input,
    });
    const { adjudication, requests } = created.resource;
    return {
      document: created.resource,
      links: [
        mcpResourceLink("waiver-adjudications", adjudication.id),
        ...requests.map(({ id }: { id: string }) =>
          mcpResourceLink("waiver-requests", id),
        ),
      ],
      resourceIds: [
        input.evaluationId,
        adjudication.id,
        ...requests.map(({ id }: { id: string }) => id),
      ],
    };
  }
  if (name !== "quality_bar.get_waiver_adjudication") {
    throw mcpError("request_malformed", "Unknown waiver tool");
  }
  const { adjudicationId } = waiverAdjudicationArguments(arguments_);
  const document = evaluations.readWaiverAdjudication(adjudicationId);
  return {
    document,
    links: [
      mcpResourceLink("waiver-adjudications", adjudicationId),
      ...document.request_ids.map((id) =>
        mcpResourceLink("waiver-requests", id),
      ),
      ...(document.decisions ?? []).map(({ id }) =>
        mcpResourceLink("waiver-decisions", id),
      ),
    ],
    resourceIds: [
      adjudicationId,
      ...document.request_ids,
      ...(document.decisions ?? []).map(({ id }) => id),
    ],
  };
}
