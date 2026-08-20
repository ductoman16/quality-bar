/** @param {unknown} value */
export const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
export const nonempty = (value) =>
  typeof value === "string" && value.length > 0;

/** @param {unknown} value */
export const count = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** @param {unknown} value */
export const nullableString = (value) => value === null || nonempty(value);

/** @param {any} value */
export const errorFact = (value) =>
  value === null ||
  (record(value) &&
    nonempty(value.code) &&
    nonempty(value.message ?? value.detail));

/** @param {any} value */
export const modelCapability = (value) =>
  record(value) &&
  nonempty(value.id) &&
  Array.isArray(value.reasoning_efforts) &&
  value.reasoning_efforts.every(nonempty) &&
  Array.isArray(value.service_tiers) &&
  value.service_tiers.every(nonempty);
