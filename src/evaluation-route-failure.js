import { isUnavailableError } from "./http-request.js";

/** @param {Error & {code: string, unavailable?: boolean}} failure */
export function evaluationFailureStatus(failure) {
  const { code } = failure;
  if (code === "authentication_required") {
    return 401;
  }
  if (
    [
      "csrf_invalid",
      "origin_invalid",
      "waiver_adjudication_recovery_forbidden",
      "evaluation_pre_start_retry_forbidden",
    ].includes(code)
  ) {
    return 403;
  }
  if (
    [
      "cursor_invalid",
      "idempotency_key_required",
      "page_size_invalid",
      "request_malformed",
    ].includes(code)
  ) {
    return 400;
  }
  if (
    [
      "evaluation_not_found",
      "finding_not_found",
      "repository_not_found",
      "review_run_not_found",
      "waiver_adjudication_not_found",
      "waiver_request_not_found",
      "waiver_decision_not_found",
    ].includes(code)
  ) {
    return 404;
  }
  if (
    [
      "evaluation_result_not_ready",
      "evaluation_not_cancellable",
      "evaluation_pre_start_retry_conflict",
      "evaluation_pre_start_retry_not_exhausted",
      "idempotency_conflict",
      "waiver_adjudication_active",
      "waiver_adjudication_decision_retry_required",
      "waiver_adjudication_decisions_exist",
      "waiver_adjudication_recovery_conflict",
      "waiver_adjudication_recovery_invalid",
      "waiver_adjudication_recovery_not_exhausted",
      "waiver_finding_ineligible",
      "waiver_error_retry_ineligible",
      "waiver_request_accepted",
      "waiver_request_decision_required",
      "waiver_request_error_retry_required",
      "waiver_request_duplicate",
      "waiver_request_limit_reached",
      "repository_disabled",
      "repository_not_enabled",
      "repository_retired",
    ].includes(code)
  ) {
    return 409;
  }
  if (
    [
      "evaluation_git_acquisition_failed",
      "evaluation_git_acquisition_unavailable",
      "capacity_unavailable",
      "repository_authentication_failed",
      "repository_git_credentials_unavailable",
      "repository_git_read_failed",
      "repository_permission_denied",
      "review_run_admission_unavailable",
      "storage_reserve_check_failed",
      "storage_reserve_unavailable",
      "waiver_adjudicator_configuration_required",
    ].includes(code) ||
    failure.unavailable === true ||
    isUnavailableError(failure)
  ) {
    return 503;
  }
  return 422;
}
