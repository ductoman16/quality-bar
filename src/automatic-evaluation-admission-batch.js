/** @param {unknown} value */
function requireAutomaticEvaluationAdmission(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "afterCommit") !== "function" ||
    !Reflect.get(value, "resource")
  ) {
    throw new TypeError("Automatic Evaluation admission result is invalid");
  }
  return /** @type {{afterCommit: () => void, resource: any}} */ (value);
}

/** @param {{afterCommit: () => void}[]} admissions */
export function completeAutomaticEvaluationAdmissions(admissions) {
  for (const admission of admissions) {
    admission.afterCommit();
  }
}

/** @param {any} transaction @param {any[]} inputs @param {(transaction: any, input: any) => unknown} admit */
export function admitAutomaticEvaluations(transaction, inputs, admit) {
  return inputs.map((input) =>
    requireAutomaticEvaluationAdmission(admit(transaction, input)),
  );
}

/** @param {{changeset: any}[]} inputs @param {Set<any>} releaseAttempted */
export function releaseAutomaticEvaluationChangesets(inputs, releaseAttempted) {
  for (const { changeset } of inputs) {
    releaseAttempted.add(changeset);
    changeset.release?.();
  }
}
