export const REVIEW_RUN_ACCEPTED_SUBMISSION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS review_run_accepted_submissions (
    review_run_id TEXT PRIMARY KEY REFERENCES review_runs(id),
    submission_json TEXT NOT NULL CHECK (json_valid(submission_json)),
    accepted_at INTEGER NOT NULL CHECK (accepted_at >= 0)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS review_run_accepted_submission_immutable
    BEFORE UPDATE ON review_run_accepted_submissions
    BEGIN SELECT RAISE(ABORT, 'review_run_accepted_submission_immutable'); END;
`;

/** @param {unknown} submission */
export function encodeReviewRunSubmission(submission) {
  return JSON.stringify(submission);
}

/** @param {unknown} encoded */
export function decodeReviewRunSubmission(encoded) {
  if (typeof encoded !== "string") {
    throw new TypeError("Accepted Review Run submission is invalid");
  }
  const submission = JSON.parse(encoded);
  if (
    !submission ||
    !Array.isArray(submission.criteria) ||
    !Array.isArray(submission.fileChanges) ||
    !Array.isArray(submission.results) ||
    typeof submission.evaluationId !== "string" ||
    typeof submission.reviewVersionId !== "string"
  ) {
    throw new TypeError("Accepted Review Run submission is invalid");
  }
  return submission;
}
