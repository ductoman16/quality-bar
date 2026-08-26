import { createHash } from "node:crypto";

import {
  failEvaluation,
  requireIdempotencyKey,
} from "../evaluation/evaluation-validation.ts";
import { freezeWaiverAdjudicatorConfiguration } from "./waiver-adjudicator-configuration.ts";
import {
  assertNoActiveWaiverAdjudication,
  persistQueuedWaiverAdjudication,
  readWaiverEvaluation,
  readWaiverReplay,
} from "./waiver-adjudication-persistence.ts";

function invalidErrorRetry() {
  failEvaluation(
    "waiver_error_retry_invalid",
    "Waiver error retry must contain unique Request identities",
  );
}

export function canonicalWaiverErrorRetryRequest(candidate: unknown) {
  const input = candidate as any;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.request_ids) ||
    input.request_ids.length === 0
  ) {
    invalidErrorRetry();
  }
  const requestIds = new Set();
  for (const requestId of input.request_ids) {
    if (
      typeof requestId !== "string" ||
      requestId.length === 0 ||
      requestIds.has(requestId)
    ) {
      invalidErrorRetry();
    }
    requestIds.add(requestId);
  }
  return { request_ids: [...requestIds].sort() };
}

export function createWaiverErrorRetryService(
  durableCore: any,
  {
    createAdjudicationId,
    now,
    readCodexCapabilityFailure,
    storageReserve,
  }: {
    createAdjudicationId: () => string;
    now: () => number;
    readCodexCapabilityFailure: () =>
      | (Error & { code: string; unavailable?: boolean })
      | null;
    storageReserve: { assertWorkAdmissionAvailable: () => unknown };
  },
) {
  return {
    retry({
      channel,
      evaluationId,
      idempotencyKey,
      request,
    }: {
      channel: "browser_session" | "implementer_token";
      evaluationId: string;
      idempotencyKey: unknown;
      request: unknown;
    }) {
      if (
        !["browser_session", "implementer_token"].includes(channel) ||
        typeof evaluationId !== "string" ||
        evaluationId.length === 0
      ) {
        throw new TypeError("Waiver error retry identity is invalid");
      }
      if (channel !== "browser_session") {
        failEvaluation(
          "waiver_error_retry_forbidden",
          "Only the operator may retry errored Waiver Requests",
        );
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const canonical = canonicalWaiverErrorRetryRequest(request);
      const route = `/api/v1/evaluations/${evaluationId}/waiver-adjudications/error-retries`;
      const hash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      const replay = readWaiverReplay(durableCore, {
        channel,
        hash,
        key,
        route,
      });
      if (replay) {
        return replay;
      }
      storageReserve.assertWorkAdmissionAvailable();
      const capabilityFailure = readCodexCapabilityFailure();
      if (capabilityFailure) {
        throw capabilityFailure;
      }
      const createdAt = now();
      const adjudicationId = createAdjudicationId();
      if (
        !Number.isSafeInteger(createdAt) ||
        typeof adjudicationId !== "string" ||
        adjudicationId.length === 0
      ) {
        throw new TypeError(
          "Waiver error retry identity or timestamp is invalid",
        );
      }
      return durableCore.transaction((transaction: any) => {
        const racedReplay = readWaiverReplay(transaction, {
          channel,
          hash,
          key,
          route,
        });
        if (racedReplay) {
          return racedReplay;
        }
        const evaluation = readWaiverEvaluation(transaction, evaluationId);
        assertNoActiveWaiverAdjudication(transaction, evaluationId);
        const requests = transaction.all(
          `SELECT waiver_requests.id, waiver_requests.evaluation_id,
                  waiver_requests.finding_id, waiver_requests.rationale,
                  waiver_requests.created_at,
                  (
                    SELECT waiver_decisions.outcome
                    FROM waiver_adjudication_requests
                    JOIN waiver_adjudications
                      ON waiver_adjudications.id =
                           waiver_adjudication_requests.waiver_adjudication_id
                    LEFT JOIN waiver_decisions
                      ON waiver_decisions.waiver_adjudication_id =
                           waiver_adjudication_requests.waiver_adjudication_id
                     AND waiver_decisions.waiver_request_id =
                           waiver_adjudication_requests.waiver_request_id
                    WHERE waiver_adjudication_requests.waiver_request_id =
                            waiver_requests.id
                    ORDER BY waiver_adjudications.rowid DESC
                    LIMIT 1
                  ) AS latest_decision
           FROM waiver_requests
           WHERE waiver_requests.id IN (${canonical.request_ids.map(() => "?").join(",")})`,
          ...canonical.request_ids,
        );
        const byId = new Map<any, any>(
          requests.map((requestValue: any) => [requestValue.id, requestValue]),
        );
        for (const requestId of canonical.request_ids) {
          const requestValue = byId.get(requestId);
          if (!requestValue) {
            failEvaluation(
              "waiver_request_not_found",
              "Waiver Request was not found",
            );
          }
          if (requestValue.evaluation_id !== evaluationId) {
            failEvaluation(
              "waiver_cross_evaluation",
              "Every Waiver Request must belong to the addressed Evaluation",
            );
          }
          if (requestValue.latest_decision !== "error") {
            failEvaluation(
              "waiver_error_retry_ineligible",
              "Only a Waiver Request whose newest Decision is error may be retried",
            );
          }
        }
        const configuration = freezeWaiverAdjudicatorConfiguration(transaction);
        const requestResources = canonical.request_ids.map((requestId) => {
          const requestValue = byId.get(requestId);
          return {
            created_at: new Date(requestValue.created_at).toISOString(),
            evaluation_id: requestValue.evaluation_id,
            finding_id: requestValue.finding_id,
            id: requestValue.id,
            rationale: requestValue.rationale,
          };
        });
        return persistQueuedWaiverAdjudication(transaction, {
          adjudicationId,
          channel,
          configuration,
          createdAt,
          evaluation,
          evaluationId,
          hash,
          key,
          requestIds: canonical.request_ids as string[],
          route,
          writeRequests: () => requestResources,
        });
      });
    },
  };
}
