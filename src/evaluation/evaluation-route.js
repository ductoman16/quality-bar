import { requireCodedError } from "../coded-error.js";
import { evaluationFailureStatus } from "./evaluation-route-failure.js";
import { writeError, writeJson } from "../http-response.js";
import { writeWaiverRecovery } from "../waiver/waiver-recovery-route.js";

/** @param {import("fastify").FastifyRequest} request @param {string} name */
function pathParameter(request, name) {
  return /** @type {Record<string, string>} */ (request.params)[name];
}

/** @param {{evaluations: any}} dependencies */
export function createEvaluationOperations({ evaluations }) {
  /** @param {import("fastify").FastifyRequest} request */
  function authority(request) {
    return /** @type {any} */ (request).authority;
  }

  /** @type {(operation: (request: import("fastify").FastifyRequest, response: import("fastify").FastifyReply) => unknown) => (request: import("fastify").FastifyRequest, response: import("fastify").FastifyReply) => Promise<void>} */
  const handle = (operation) => async (request, response) => {
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
        Object.entries(
          /** @type {Record<string, unknown>} */ (request.query),
        ).map(([name, value]) => [
          name,
          typeof value === "number" ? String(value) : value,
        ]),
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
