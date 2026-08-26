import {
  authenticatedMutationHeaders,
  browserMutationHeaders,
  canonicalValidationError,
  errorResponses,
  idempotencyKeyHeader,
} from "../http-route-schema.ts";

export const waiversSchemas = {};

export const waiversRoutes = [
  {
    method: "GET",
    schema: {
      operationId: "getWaiverAdjudicatorConfiguration",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverAdjudicatorConfigurationState#",
          description: "Installation-wide Waiver Adjudicator Configuration",
        },
        ...errorResponses(400, 401, 403, 422, 500, 503),
      },
    },
    url: "/api/v1/waiver-adjudicator-configuration",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "codex_configuration_malformed",
        "Codex configuration must contain only exact model, reasoning_effort, and service_tier values",
        422,
      ),
      operationId: "updateWaiverAdjudicatorConfiguration",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverAdjudicatorConfigurationChange#",
          description: "Waiver Adjudicator Configuration change",
        },
        ...errorResponses(400, 401, 403, 422, 500, 503),
      },
      body: {
        $ref: "CodexConfiguration#",
      },
    },
    url: "/api/v1/waiver-adjudicator-configuration",
  },
  {
    method: "GET",
    schema: {
      operationId: "listEvaluationWaiverAdjudications",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverAdjudicationOperationalCollection#",
          description: "Current operational Waiver Adjudication projection",
        },
        ...errorResponses(400, 401, 404),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/waiver-adjudications",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "waiver_batch_invalid",
        "Waiver batch must contain unique Findings with nonblank rationales",
        422,
      ),
      headers: authenticatedMutationHeaders(
        { "idempotency-key": idempotencyKeyHeader },
        ["idempotency-key"],
      ),
      operationId: "submitWaiverBatch",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        201: {
          $ref: "WaiverBatch#",
          description: "Atomic Waiver Request batch and queued Adjudication",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "WaiverBatchRequest#",
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/waiver-adjudications",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "waiver_error_retry_invalid",
        "Waiver error retry must contain unique Request identities",
        422,
      ),
      headers: browserMutationHeaders(
        { "idempotency-key": idempotencyKeyHeader },
        ["idempotency-key"],
      ),
      operationId: "retryWaiverErrors",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          $ref: "WaiverBatch#",
          description:
            "Later Adjudication over existing errored Waiver Requests",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "WaiverErrorRetryRequest#",
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/waiver-adjudications/error-retries",
  },
  {
    method: "GET",
    schema: {
      operationId: "getWaiverRequest",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverRequest#",
          description: "Complete immutable Waiver Request",
        },
        ...errorResponses(400, 401, 404, 503),
      },
    },
    url: "/api/v1/waiver-requests/:waiver_request_id",
  },
  {
    method: "GET",
    schema: {
      operationId: "getWaiverAdjudication",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverAdjudication#",
          description: "Current canonical Waiver Adjudication",
        },
        ...errorResponses(400, 401, 404, 503),
      },
    },
    url: "/api/v1/waiver-adjudications/:waiver_adjudication_id",
  },
  {
    method: "GET",
    schema: {
      operationId: "getWaiverDecision",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverDecision#",
          description: "Complete immutable Waiver Decision",
        },
        ...errorResponses(400, 401, 404, 503),
      },
    },
    url: "/api/v1/waiver-decisions/:waiver_decision_id",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(
        { "idempotency-key": idempotencyKeyHeader },
        ["idempotency-key"],
      ),
      operationId: "recoverWaiverAdjudication",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "WaiverBatch#",
          description: "Same-identity pre-start recovery",
        },
        201: {
          $ref: "WaiverBatch#",
          description:
            "Later Adjudication for a started failure or cancellation",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
    },
    url: "/api/v1/waiver-adjudications/:waiver_adjudication_id/recover",
  },
];
