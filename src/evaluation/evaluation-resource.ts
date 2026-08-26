import {
  readEvaluationMonitors,
  validEvaluationMonitor,
} from "./evaluation-monitor.ts";
import { effectiveEvaluationOutcome } from "../waiver/waiver-effective-outcome.ts";
import { githubDeliveryResource as delivery } from "../github/github-delivery-resource.ts";
import {
  readEvaluationPreStartRetry,
  validEvaluationPreStartRetryRow,
} from "./evaluation-pre-start-retry-resource.ts";
export { EVALUATION_SELECTION } from "./evaluation-resource-selection.ts";

const timestamp = (value: number) => new Date(value).toISOString();

export function readEvaluation(
  row: Record<string, import("node:sqlite").SQLInputValue> | undefined,
  monitor?: unknown,
) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.repository_id !== "string" ||
    typeof row.normalized_url !== "string" ||
    typeof row.base_selector_type !== "string" ||
    typeof row.base_selector_value !== "string" ||
    typeof row.head_selector_type !== "string" ||
    typeof row.head_selector_value !== "string" ||
    typeof row.base_commit !== "string" ||
    typeof row.head_commit !== "string" ||
    !["automatic", "explicit"].includes(row.resource_provenance as string) ||
    !(
      (row.resource_provenance === "explicit" &&
        row.automatic_pull_request_number === null) ||
      (row.resource_provenance === "automatic" &&
        Number.isSafeInteger(row.automatic_pull_request_number) &&
        (row.automatic_pull_request_number as number) > 0)
    ) ||
    typeof row.execution_status !== "string" ||
    ![
      row.active_waiver_adjudication_count,
      row.blocking_finding_count,
      row.current_waiver_error_count,
      row.unwaived_advisory_finding_count,
    ].every(Number.isSafeInteger) ||
    !(
      row.next_attempt_at === null || Number.isSafeInteger(row.next_attempt_at)
    ) ||
    !Number.isSafeInteger(row.created_at) ||
    (monitor !== undefined && !validEvaluationMonitor(monitor)) ||
    !validEvaluationPreStartRetryRow(row)
  ) {
    throw new TypeError("Evaluation row is invalid");
  }
  const completedAt =
    row.completed_at === null ? null : (row.completed_at as number);
  const outcome =
    row.result_outcome === null ? "pending" : (row.result_outcome as string);
  const effectiveOutcome = effectiveEvaluationOutcome({
    activeAdjudicationCount: row.active_waiver_adjudication_count as number,
    blockingFindingCount: row.blocking_finding_count as number,
    currentWaiverErrorCount: row.current_waiver_error_count as number,
    resultOutcome: outcome,
    unwaivedAdvisoryFindingCount: row.unwaived_advisory_finding_count as number,
  });
  const hasCommitStatus = row.commit_status_evaluation_id !== null;
  if (
    hasCommitStatus &&
    (row.commit_status_evaluation_id !== row.id ||
      row.commit_status_head_commit !== row.head_commit ||
      !["pending", "success", "failure", "error"].includes(
        row.commit_status_state as string,
      ) ||
      !["waiting", "succeeded", "unavailable"].includes(
        row.commit_status_publication_status as string,
      ))
  ) {
    throw new TypeError("Evaluation commit status row is invalid");
  }
  const commitStatusError =
    row.commit_status_error_code === null &&
    row.commit_status_delivery_error_code === null
      ? null
      : {
          code:
            row.commit_status_error_code ??
            row.commit_status_delivery_error_code,
          detail:
            row.commit_status_error_detail ??
            row.commit_status_delivery_error_detail,
        };
  const hasFeedback = row.feedback_evaluation_id !== null;
  let findingFeedback = [];
  if (hasFeedback) {
    if (
      row.feedback_evaluation_id !== row.id ||
      !["waiting", "succeeded", "unavailable"].includes(
        row.feedback_publication_status as string,
      ) ||
      typeof row.finding_feedback_json !== "string"
    ) {
      throw new TypeError("Evaluation feedback row is invalid");
    }
    try {
      findingFeedback = JSON.parse(row.finding_feedback_json);
    } catch {
      throw new TypeError("Evaluation Finding feedback is invalid");
    }
    if (
      !Array.isArray(findingFeedback) ||
      findingFeedback.some(
        (item) =>
          typeof item?.finding_id !== "string" ||
          !["aggregate_only", "waiting", "succeeded", "unavailable"].includes(
            item.publication_status,
          ) ||
          !(
            item.external_id === null || Number.isSafeInteger(item.external_id)
          ) ||
          !(
            item.published_at === null ||
            Number.isSafeInteger(item.published_at)
          ) ||
          !(
            item.error_code === null ||
            (typeof item.error_code === "string" &&
              typeof item.error_detail === "string")
          ),
      )
    ) {
      throw new TypeError("Evaluation Finding feedback is invalid");
    }
  }
  const feedbackError =
    row.feedback_error_code === null &&
    row.feedback_delivery_error_code === null
      ? null
      : {
          code: row.feedback_error_code ?? row.feedback_delivery_error_code,
          detail:
            row.feedback_error_detail ?? row.feedback_delivery_error_detail,
        };
  return {
    base_commit: row.base_commit,
    base_selector: {
      type: row.base_selector_type,
      value: row.base_selector_value,
    },
    completed_at: completedAt === null ? null : timestamp(completedAt),
    ...(hasCommitStatus
      ? {
          commit_status: {
            ...delivery({
              attempt_count: row.commit_status_attempt_count,
              connection_identity: row.commit_status_connection_identity,
              delivery_next_attempt_at:
                row.commit_status_delivery_next_attempt_at,
              last_attempt_at: row.commit_status_last_attempt_at,
              provider_gate_until:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_until
                  : null,
              provider_gate_error_code:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_error_code
                  : null,
              provider_gate_error_detail:
                row.commit_status_publication_status === "waiting"
                  ? row.commit_status_provider_gate_error_detail
                  : null,
              reconciliation_required:
                row.commit_status_reconciliation_required,
              source_identity: row.commit_status_source_identity,
              target: row.commit_status_target,
            }),
            context: "Quality Bar",
            error: commitStatusError,
            external_id: row.commit_status_external_id,
            head_commit: row.commit_status_head_commit,
            publication_status: row.commit_status_publication_status,
            published_at:
              row.commit_status_published_at === null
                ? null
                : timestamp(row.commit_status_published_at as number),
            state: row.commit_status_state,
          },
        }
      : {}),
    ...(hasFeedback
      ? {
          feedback: {
            aggregate: {
              ...delivery({
                attempt_count: row.feedback_attempt_count,
                connection_identity: row.feedback_connection_identity,
                delivery_next_attempt_at: row.feedback_delivery_next_attempt_at,
                last_attempt_at: row.feedback_last_attempt_at,
                provider_gate_until:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_until
                    : null,
                provider_gate_error_code:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_error_code
                    : null,
                provider_gate_error_detail:
                  row.feedback_publication_status === "waiting"
                    ? row.feedback_provider_gate_error_detail
                    : null,
                reconciliation_required: row.feedback_reconciliation_required,
                source_identity: row.feedback_source_identity,
                target: row.feedback_target,
              }),
              error: feedbackError,
              external_id: row.feedback_external_id,
              publication_status: row.feedback_publication_status,
              published_at:
                row.feedback_published_at === null
                  ? null
                  : timestamp(row.feedback_published_at as number),
            },
            findings: findingFeedback.map((item) => ({
              ...(item.publication_status === "aggregate_only"
                ? {
                    attempt_count: 0,
                    connection_identity: null,
                    last_attempt_at: null,
                    next_attempt_at: null,
                    provider_gate_until: null,
                    provider_gate_error: null,
                    reconciliation_required: false,
                    source_identity: item.finding_id,
                    target: "aggregate_only",
                  }
                : delivery({
                    attempt_count: item.attempt_count,
                    connection_identity: item.connection_identity,
                    delivery_next_attempt_at: item.delivery_next_attempt_at,
                    last_attempt_at: item.last_attempt_at,
                    provider_gate_until:
                      item.publication_status === "waiting"
                        ? item.provider_gate_until
                        : null,
                    provider_gate_error_code:
                      item.publication_status === "waiting"
                        ? item.provider_gate_error_code
                        : null,
                    provider_gate_error_detail:
                      item.publication_status === "waiting"
                        ? item.provider_gate_error_detail
                        : null,
                    reconciliation_required: item.reconciliation_required,
                    source_identity: item.source_identity,
                    target: item.target,
                  })),
              error:
                item.error_code === null && item.delivery_error_code === null
                  ? null
                  : {
                      code: item.error_code ?? item.delivery_error_code,
                      detail: item.error_detail ?? item.delivery_error_detail,
                    },
              external_id: item.external_id,
              finding_id: item.finding_id,
              publication_status: item.publication_status,
              published_at:
                item.published_at === null
                  ? null
                  : timestamp(item.published_at),
            })),
          },
        }
      : {}),
    created_at: timestamp(row.created_at as number),
    ...(monitor === undefined ? {} : { monitor }),
    effective_outcome: effectiveOutcome,
    execution_status: row.execution_status,
    head_commit: row.head_commit,
    head_selector: {
      type: row.head_selector_type,
      value: row.head_selector_value,
    },
    id: row.id,
    ...readEvaluationPreStartRetry(row),
    provenance: row.resource_provenance,
    ...(row.resource_provenance === "automatic"
      ? {
          pull_request: {
            number: row.automatic_pull_request_number as number,
          },
        }
      : {}),
    repository: { id: row.repository_id, url: row.normalized_url },
  };
}

export function readEvaluationWithMonitor(
  durableCore: { all: Function },
  row: Record<string, import("node:sqlite").SQLInputValue> | undefined,
) {
  if (!row || typeof row.id !== "string") {
    throw new TypeError("Evaluation row is invalid");
  }
  const monitor = readEvaluationMonitors(durableCore, [row]).get(row.id);
  if (!monitor) {
    throw new TypeError("Evaluation monitor is missing");
  }
  return readEvaluation(row, monitor);
}
