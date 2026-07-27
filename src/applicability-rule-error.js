export class ApplicabilityRuleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ApplicabilityRuleError";
    this.code = code;
  }
}

/** @param {string} code @param {string} message @returns {never} */
export function failApplicabilityRule(code, message) {
  throw new ApplicabilityRuleError(code, message);
}
