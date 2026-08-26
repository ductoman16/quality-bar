export function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function requiredUri(value: unknown, name: string) {
  const stringValue = requiredString(value, name);
  try {
    new URL(stringValue);
  } catch (cause) {
    throw new TypeError(`${name} is invalid`, { cause });
  }
  return stringValue;
}

export function requiredSafeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function requiredPositiveSafeInteger(
  value: unknown,
  name: string,
): number {
  const integer = requiredSafeInteger(value, name);
  if (integer === 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return integer;
}

export function optionalSafeInteger(value: unknown, name: string) {
  if (value !== null) {
    requiredSafeInteger(value, name);
  }
  return value as number | null;
}

export function optionalPositiveSafeInteger(value: unknown, name: string) {
  if (value !== null) {
    requiredPositiveSafeInteger(value, name);
  }
  return value as number | null;
}

export function timestamp(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("System timestamp is invalid");
  }
  return new Date(value).toISOString();
}

export function optionalTimestamp(value: number | null) {
  return value === null ? null : timestamp(value);
}

export function optionalNextAttemptTimestamp(value: number | null) {
  return value === null || value === 0 || value === Number.MAX_SAFE_INTEGER
    ? null
    : timestamp(value);
}

export function readError(row: any, codeKey: string, detailKey: string) {
  const code = row[codeKey];
  const detail = row[detailKey];
  if ((code === null) !== (detail === null)) {
    throw new TypeError("System error pair is invalid");
  }
  if (code === null) {
    return null;
  }
  const systemCode = requiredString(code, "System error code");
  if (systemCode.trim().length === 0) {
    throw new TypeError("System error code is invalid");
  }
  const systemDetail = requiredString(detail, "System error detail");
  if (systemDetail.trim().length === 0) {
    throw new TypeError("System error detail is invalid");
  }
  return {
    code: systemCode,
    detail: systemDetail,
  };
}

export function readProviderGate(row: any) {
  const until = optionalSafeInteger(
    row.provider_gate_until,
    "System provider gate deadline",
  );
  const error = readError(
    row,
    "provider_gate_error_code",
    "provider_gate_error_detail",
  );
  if ((until === null) !== (error === null)) {
    throw new TypeError("System provider gate is incomplete");
  }
  return { error, until };
}

export function readDeliveryAttempt(row: any, prefix: string) {
  const count = row[`${prefix}attempt_count`];
  if (count === null) {
    if (
      row[`${prefix}last_attempt_at`] !== null ||
      row[`${prefix}next_attempt_at`] !== null ||
      row[`${prefix}reconciliation_required`] !== null ||
      row[`${prefix}external_id`] !== null ||
      row[`${prefix}error_code`] !== null ||
      row[`${prefix}error_detail`] !== null ||
      row[`${prefix}definitive`] !== null
    ) {
      throw new TypeError("System delivery attempt row is incomplete");
    }
    return {
      attempt_count: 0,
      definitive: false,
      error: null,
      external_id: null,
      last_attempt_at: null,
      next_attempt_at: null,
      reconciliation_required: false,
    };
  }
  requiredSafeInteger(count, "System delivery attempt count");
  const lastAttemptAt = optionalSafeInteger(
    row[`${prefix}last_attempt_at`],
    "System delivery last attempt",
  );
  const nextAttemptAt = requiredSafeInteger(
    row[`${prefix}next_attempt_at`],
    "System delivery next attempt",
  );
  const reconciliationRequired = row[`${prefix}reconciliation_required`];
  if (![0, 1].includes(reconciliationRequired)) {
    throw new TypeError("System delivery reconciliation state is invalid");
  }
  const externalId = optionalPositiveSafeInteger(
    row[`${prefix}external_id`],
    "System delivery external identity",
  );
  const error = readError(row, `${prefix}error_code`, `${prefix}error_detail`);
  const definitive = row[`${prefix}definitive`];
  if (![0, 1].includes(definitive)) {
    throw new TypeError("System delivery definitive state is invalid");
  }
  if (definitive === 1 && error === null) {
    throw new TypeError("System definitive delivery has no error");
  }
  if (count === 0 && lastAttemptAt !== null) {
    throw new TypeError("System delivery attempt count is inconsistent");
  }
  if (count > 0 && lastAttemptAt === null) {
    throw new TypeError("System delivery attempt timestamp is missing");
  }
  return {
    attempt_count: count,
    definitive: definitive === 1,
    error,
    external_id: externalId,
    last_attempt_at: lastAttemptAt,
    next_attempt_at: nextAttemptAt,
    reconciliation_required: reconciliationRequired === 1,
  };
}
