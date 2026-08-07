/** @param {unknown} value @param {string} name */
export function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

/** @param {unknown} value @param {string} name */
export function requiredUri(value, name) {
  const stringValue = requiredString(value, name);
  try {
    new URL(stringValue);
  } catch (cause) {
    throw new TypeError(`${name} is invalid`, { cause });
  }
  return stringValue;
}

/** @param {unknown} value @param {string} name @returns {number} */
export function requiredSafeInteger(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

/** @param {unknown} value @param {string} name @returns {number} */
export function requiredPositiveSafeInteger(value, name) {
  const integer = requiredSafeInteger(value, name);
  if (integer === 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return integer;
}

/** @param {unknown} value @param {string} name */
export function optionalSafeInteger(value, name) {
  if (value !== null) {
    requiredSafeInteger(value, name);
  }
  return /** @type {number | null} */ (value);
}

/** @param {unknown} value @param {string} name */
export function optionalPositiveSafeInteger(value, name) {
  if (value !== null) {
    requiredPositiveSafeInteger(value, name);
  }
  return /** @type {number | null} */ (value);
}

/** @param {number} value */
export function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("System timestamp is invalid");
  }
  return new Date(value).toISOString();
}

/** @param {number | null} value */
export function optionalTimestamp(value) {
  return value === null ? null : timestamp(value);
}

/** @param {number | null} value */
export function optionalNextAttemptTimestamp(value) {
  return value === null || value === 0 || value === Number.MAX_SAFE_INTEGER
    ? null
    : timestamp(value);
}

/** @param {any} row @param {string} codeKey @param {string} detailKey */
export function readError(row, codeKey, detailKey) {
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

/** @param {any} row */
export function readProviderGate(row) {
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

/** @param {any} row @param {string} prefix */
export function readDeliveryAttempt(row, prefix) {
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
