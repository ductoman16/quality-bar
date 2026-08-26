export class ApplicabilityRuleError extends Error {
  name: "ApplicabilityRuleError";
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApplicabilityRuleError";
    this.code = code;
  }
}

export function failApplicabilityRule(code: string, message: string): never {
  throw new ApplicabilityRuleError(code, message);
}
