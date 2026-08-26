export function createEvaluationIdentity(
  createId: () => string,
  now: () => number,
) {
  const evaluationId = createId();
  const createdAt = now();
  if (
    typeof evaluationId !== "string" ||
    evaluationId.length === 0 ||
    !Number.isSafeInteger(createdAt)
  ) {
    throw new TypeError("Evaluation identity or timestamp is invalid");
  }
  return { createdAt, evaluationId };
}
