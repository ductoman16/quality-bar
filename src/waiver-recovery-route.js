import { writeJson } from "./http-response.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof import("./evaluation.js").createEvaluationService>} evaluations
 * @param {string} adjudicationId
 * @param {unknown} idempotencyKey
 */
export function writeWaiverRecovery(
  response,
  evaluations,
  adjudicationId,
  idempotencyKey,
) {
  const recovered = evaluations.recoverWaiverAdjudication({
    adjudicationId,
    channel: "browser_session",
    idempotencyKey,
  });
  writeJson(response, recovered.status, recovered.resource, {
    location: `/api/v1/waiver-adjudications/${encodeURIComponent(
      recovered.resource.adjudication.id,
    )}`,
  });
}
