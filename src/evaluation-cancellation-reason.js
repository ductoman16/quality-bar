export const OPERATOR_CANCELLATION = Object.freeze({
  code: "cancelled_by_operator",
  detail: "Evaluation was cancelled by the operator",
});

export const SUPERSESSION_CANCELLATION = Object.freeze({
  code: "cancelled_by_supersession",
  detail: "Evaluation was superseded by a different pull request Changeset",
});

export const EVALUATION_CANCELLATION_CODES = Object.freeze([
  OPERATOR_CANCELLATION.code,
  SUPERSESSION_CANCELLATION.code,
]);

export const EVALUATION_CANCELLATION_SQL_CODES =
  EVALUATION_CANCELLATION_CODES.map((code) => `'${code}'`).join(", ");
