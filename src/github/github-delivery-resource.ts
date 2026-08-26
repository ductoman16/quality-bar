const timestamp = (value: number) => new Date(value).toISOString();

export function githubDeliveryResource(value: any) {
  if (
    typeof value.source_identity !== "string" ||
    typeof value.target !== "string" ||
    !(
      value.connection_identity === null ||
      (typeof value.connection_identity === "string" &&
        value.connection_identity.length > 0)
    ) ||
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
    ) ||
    !(
      (value.provider_gate_until === null &&
        value.provider_gate_error_code === null &&
        value.provider_gate_error_detail === null) ||
      (Number.isSafeInteger(value.provider_gate_until) &&
        typeof value.provider_gate_error_code === "string" &&
        value.provider_gate_error_code.length > 0 &&
        typeof value.provider_gate_error_detail === "string" &&
        value.provider_gate_error_detail.length > 0)
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
    connection_identity: value.connection_identity,
    last_attempt_at:
      value.last_attempt_at === null ? null : timestamp(value.last_attempt_at),
    next_attempt_at: nextAttemptAt === 0 ? null : timestamp(nextAttemptAt),
    provider_gate_until:
      value.provider_gate_until === null
        ? null
        : timestamp(value.provider_gate_until),
    provider_gate_error:
      value.provider_gate_until === null
        ? null
        : {
            code: value.provider_gate_error_code,
            detail: value.provider_gate_error_detail,
          },
    reconciliation_required: value.reconciliation_required === 1,
    source_identity: value.source_identity,
    target: value.target,
  };
}
