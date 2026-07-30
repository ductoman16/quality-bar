const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {any} value */
export function githubDeliveryResource(value) {
  if (
    typeof value.source_identity !== "string" ||
    typeof value.target !== "string" ||
    !Number.isSafeInteger(value.attempt_count) ||
    value.attempt_count < 0 ||
    !(
      value.last_attempt_at === null ||
      Number.isSafeInteger(value.last_attempt_at)
    ) ||
    !Number.isSafeInteger(value.delivery_next_attempt_at) ||
    ![0, 1].includes(value.reconciliation_required) ||
    !(
      value.provider_gate_until === null ||
      Number.isSafeInteger(value.provider_gate_until)
    )
  ) {
    throw new TypeError("GitHub delivery attempt row is invalid");
  }
  const nextAttemptAt = Math.max(
    value.delivery_next_attempt_at,
    value.provider_gate_until ?? 0,
  );
  return {
    attempt_count: value.attempt_count,
    last_attempt_at:
      value.last_attempt_at === null ? null : timestamp(value.last_attempt_at),
    next_attempt_at: nextAttemptAt === 0 ? null : timestamp(nextAttemptAt),
    provider_gate_until:
      value.provider_gate_until === null
        ? null
        : timestamp(value.provider_gate_until),
    reconciliation_required: value.reconciliation_required === 1,
    source_identity: value.source_identity,
    target: value.target,
  };
}
