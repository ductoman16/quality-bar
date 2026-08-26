import { writeJson } from "../http-response.ts";

export function writeWaiverRecovery(
  response: import("fastify").FastifyReply,
  evaluations: ReturnType<
    typeof import("../evaluation/evaluation.ts").createEvaluationService
  >,
  adjudicationId: string,
  idempotencyKey: unknown,
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
