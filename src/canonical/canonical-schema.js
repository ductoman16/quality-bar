/**
 * @template {Record<string, unknown>} Properties
 * @template {boolean} AdditionalProperties
 * @param {Properties} properties
 * @param {string[]} required
 * @param {AdditionalProperties} additionalProperties
 */
function objectSchema(properties, required, additionalProperties) {
  return { additionalProperties, properties, required, type: "object" };
}

/**
 * @template {Record<string, unknown>} Properties
 * @param {Properties} properties
 * @param {string[]} required
 */
export function openObject(properties, required) {
  return objectSchema(properties, required, true);
}

/**
 * @template {Record<string, unknown>} Properties
 * @param {Properties} properties
 * @param {string[]} required
 */
export function closedObject(properties, required) {
  return objectSchema(properties, required, false);
}

/** @param {Record<string, unknown>} schema @param {string} code @param {string} message @param {number} [status] */
export function withValidationError(schema, code, message, status = 422) {
  return {
    ...schema,
    "x-quality-bar-error": { code, message, status },
  };
}
