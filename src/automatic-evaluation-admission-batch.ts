function requireAutomaticEvaluationAdmission(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "afterCommit") !== "function" ||
    !Reflect.get(value, "resource")
  ) {
    throw new TypeError("Automatic Evaluation admission result is invalid");
  }
  return value as { afterCommit: () => void; resource: any };
}

export function completeAutomaticEvaluationAdmissions(
  admissions: { afterCommit: () => void }[],
) {
  for (const admission of admissions) {
    admission.afterCommit();
  }
}

export function admitAutomaticEvaluations(
  transaction: any,
  inputs: any[],
  admit: (transaction: any, input: any) => unknown,
) {
  return inputs.map((input) =>
    requireAutomaticEvaluationAdmission(admit(transaction, input)),
  );
}

export function releaseAutomaticEvaluationChangesets(
  inputs: { changeset: any }[],
  releaseAttempted: Set<any>,
) {
  for (const { changeset } of inputs) {
    releaseAttempted.add(changeset);
    changeset.release?.();
  }
}
