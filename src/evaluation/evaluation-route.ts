import { requireCodedError } from "../coded-error.ts";
import { evaluationFailureStatus } from "./evaluation-route-failure.ts";
import { writeError, writeJson } from "../http-response.ts";
import { writeWaiverRecovery } from "../waiver/waiver-recovery-route.ts";

function pathParameter(
  request: import("fastify").FastifyRequest,
  name: string,
) {
  return (request.params as Record<string, string>)[name];
}

export function createEvaluationOperations({
  evaluations,
}: {
  evaluations: any;
}) {
  function authority(request: import("fastify").FastifyRequest) {
    return (request as any).authority;
  }

  const handle: (
    operation: (
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) => unknown,
  ) => (
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
  ) => Promise<void> = (operation) => async (request, response) => {
    try {
      await operation(request, response);
    } catch (error) {
      const failure = requireCodedError(error);
      writeError(
        response,
        evaluationFailureStatus(failure),
        failure.code,
        failure.message,
      );
    }
  };

  const operations = {
    listEvaluations: handle((request, response) => {
      const query = Object.fromEntries(
        Object.entries(request.query as Record<string, unknown>).map(
          ([name, value]) => [
            name,
            typeof value === "number" ? String(value) : value,
          ],
        ),
      );
      writeJson(response, 200, evaluations.list(query));
    }),
    getEvaluation: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.read(pathParameter(request, "evaluation_id")),
      ),
    ),
    getEvaluationResult: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readResult(pathParameter(request, "evaluation_id")),
      ),
    ),
    getEvaluationReviewRun: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readReviewRun(
          pathParameter(request, "evaluation_id"),
          pathParameter(request, "review_run_id"),
        ),
      ),
    ),
    getEvaluationFinding: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readFinding(
          pathParameter(request, "evaluation_id"),
          pathParameter(request, "finding_id"),
        ),
      ),
    ),
    getReviewRunDiagnostics: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readReviewRunDiagnostics(
          pathParameter(request, "evaluation_id"),
          pathParameter(request, "review_run_id"),
        ),
      ),
    ),
    listEvaluationWaiverAdjudications: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readWaiverAdjudications(
          pathParameter(request, "evaluation_id"),
        ),
      ),
    ),
    getWaiverRequest: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readWaiverRequest(
          pathParameter(request, "waiver_request_id"),
        ),
      ),
    ),
    getWaiverAdjudication: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readWaiverAdjudication(
          pathParameter(request, "waiver_adjudication_id"),
        ),
      ),
    ),
    getWaiverDecision: handle((request, response) =>
      writeJson(
        response,
        200,
        evaluations.readWaiverDecision(
          pathParameter(request, "waiver_decision_id"),
        ),
      ),
    ),
    retryEvaluationPreStart: handle((request, response) => {
      const retried = evaluations.retryPreStart({
        channel:
          authority(request) === "machine"
            ? "implementer_token"
            : "browser_session",
        evaluationId: pathParameter(request, "evaluation_id"),
        idempotencyKey: request.headers["idempotency-key"],
      });
      writeJson(response, retried.status, retried.resource);
    }),
    cancelEvaluation: handle((request, response) => {
      writeJson(
        response,
        200,
        evaluations.cancel(pathParameter(request, "evaluation_id")),
      );
    }),
    submitWaiverBatch: handle((request, response) => {
      const created = evaluations.submitWaiverBatch({
        channel:
          authority(request) === "machine"
            ? "implementer_token"
            : "browser_session",
        evaluationId: pathParameter(request, "evaluation_id"),
        idempotencyKey: request.headers["idempotency-key"],
        request: request.body,
      });
      writeJson(response, created.status, created.resource, {
        location: `/api/v1/waiver-adjudications/${encodeURIComponent(created.resource.adjudication.id)}`,
      });
    }),
    retryWaiverErrors: handle((request, response) => {
      const created = evaluations.retryWaiverErrors({
        channel: "browser_session",
        evaluationId: pathParameter(request, "evaluation_id"),
        idempotencyKey: request.headers["idempotency-key"],
        request: request.body,
      });
      writeJson(response, created.status, created.resource, {
        location: `/api/v1/waiver-adjudications/${encodeURIComponent(created.resource.adjudication.id)}`,
      });
    }),
    recoverWaiverAdjudication: handle((request, response) => {
      writeWaiverRecovery(
        response,
        evaluations,
        pathParameter(request, "waiver_adjudication_id"),
        request.headers["idempotency-key"],
      );
    }),
    createExplicitEvaluation: handle(async (request, response) => {
      const created = await evaluations.createExplicit({
        channel:
          authority(request) === "machine"
            ? "implementer_token"
            : "browser_session",
        idempotencyKey: request.headers["idempotency-key"],
        repositoryId: pathParameter(request, "repository_id"),
        request: request.body,
      });
      writeJson(response, created.status, created.resource, {
        location: `/api/v1/evaluations/${encodeURIComponent(created.resource.id)}`,
      });
    }),
  };
  return operations;
}
