import { readSystemDeliveryRows } from "./system-delivery-selection.ts";
import { validateSystemDeliveryTargets } from "./system-delivery-target-validation.ts";
import {
  optionalNextAttemptTimestamp,
  optionalSafeInteger,
  optionalPositiveSafeInteger,
  optionalTimestamp,
  readDeliveryAttempt,
  readError,
  readProviderGate,
} from "./system-fact-validation.ts";

const DELIVERY_SURFACES = new Set([
  "commit_status",
  "aggregate_feedback",
  "inline_feedback",
]);
const DELIVERY_PUBLICATION_STATUSES = new Set([
  "aggregate_only",
  "waiting",
  "succeeded",
  "unavailable",
]);

function deliverySurface(
  row: any,
  provider: "github" | "forgejo",
  now: number,
): any {
  if (
    row.provider_gate_until !== null &&
    !Number.isSafeInteger(row.provider_gate_until)
  ) {
    throw new TypeError("System provider gate deadline is invalid");
  }
  if (
    typeof row.owner_kind !== "string" ||
    !["evaluation", "adjudication", "decision"].includes(row.owner_kind) ||
    !DELIVERY_SURFACES.has(row.surface) ||
    !DELIVERY_PUBLICATION_STATUSES.has(row.publication_status) ||
    typeof row.repository_id !== "string" ||
    row.repository_id.length === 0 ||
    typeof row.connection_id !== "string" ||
    row.connection_id.length === 0 ||
    typeof row.evaluation_id !== "string" ||
    row.evaluation_id.length === 0 ||
    typeof row.evaluation_repository_id !== "string" ||
    row.evaluation_repository_id.length === 0 ||
    (row.adjudication_id !== null &&
      (typeof row.adjudication_id !== "string" ||
        row.adjudication_id.length === 0)) ||
    (row.decision_id !== null &&
      (typeof row.decision_id !== "string" || row.decision_id.length === 0)) ||
    (row.finding_id !== null &&
      (typeof row.finding_id !== "string" || row.finding_id.length === 0)) ||
    (row.finding_evaluation_id !== null &&
      (typeof row.finding_evaluation_id !== "string" ||
        row.finding_evaluation_id.length === 0)) ||
    (row.decision_request_finding_id !== null &&
      (typeof row.decision_request_finding_id !== "string" ||
        row.decision_request_finding_id.length === 0)) ||
    (row.delivery_connection_id !== null &&
      (typeof row.delivery_connection_id !== "string" ||
        row.delivery_connection_id.length === 0)) ||
    typeof row.source_identity !== "string" ||
    row.source_identity.length === 0 ||
    (row.target !== null &&
      (typeof row.target !== "string" || row.target.length === 0))
  ) {
    throw new TypeError(`${provider} System delivery owner is invalid`);
  }
  if (row.evaluation_repository_id !== row.repository_id) {
    throw new TypeError("System delivery Evaluation ownership is invalid");
  }
  const publicationError = readError(
    row,
    "publication_error_code",
    "publication_error_detail",
  );
  const publicationExternalId = optionalPositiveSafeInteger(
    row.publication_external_id,
    "System publication external identity",
  );
  const publicationPublishedAt = optionalSafeInteger(
    row.publication_published_at,
    "System publication timestamp",
  );
  const hasAttempt = row.attempt_count !== null;
  const preAttemptWaiver = ["adjudication", "decision"].includes(
    row.owner_kind,
  );
  const attempt = readDeliveryAttempt(row, "");
  if (
    row.delivery_connection_id !== null &&
    row.delivery_connection_id !== row.connection_id
  ) {
    throw new TypeError("System delivery Connection ownership is invalid");
  }
  if (
    row.delivery_connection_id === null &&
    (attempt.attempt_count > 0 ||
      attempt.external_id !== null ||
      attempt.reconciliation_required)
  ) {
    throw new TypeError("System delivery Connection ownership is missing");
  }
  if (
    row.publication_status === "aggregate_only" &&
    (hasAttempt ||
      publicationError !== null ||
      publicationExternalId !== null ||
      publicationPublishedAt !== null)
  ) {
    throw new TypeError("System aggregate-only publication is invalid");
  }
  if (
    row.publication_status === "waiting" &&
    (publicationError !== null ||
      publicationExternalId !== null ||
      publicationPublishedAt !== null)
  ) {
    throw new TypeError("System waiting publication is invalid");
  }
  if (
    row.publication_status === "succeeded" &&
    (publicationError !== null || publicationPublishedAt === null)
  ) {
    throw new TypeError("System succeeded publication is invalid");
  }
  if (
    row.publication_status === "unavailable" &&
    (publicationError === null ||
      publicationExternalId !== null ||
      publicationPublishedAt !== null)
  ) {
    throw new TypeError("System unavailable publication is invalid");
  }
  if (
    !hasAttempt &&
    row.publication_status !== "aggregate_only" &&
    !preAttemptWaiver
  ) {
    throw new TypeError("System publication delivery attempt is missing");
  }
  if (row.publication_status === "succeeded" && !hasAttempt) {
    throw new TypeError("System succeeded delivery attempt is missing");
  }
  if (
    row.publication_status === "succeeded" &&
    attempt.reconciliation_required
  ) {
    throw new TypeError("System succeeded delivery is reconciling");
  }
  if (
    row.publication_status === "unavailable" &&
    attempt.reconciliation_required
  ) {
    throw new TypeError("System unavailable delivery is reconciling");
  }
  const attemptNextAt = attempt.next_attempt_at ?? 0;
  const gate = readProviderGate(row);
  if (
    publicationExternalId !== null &&
    attempt.external_id !== null &&
    publicationExternalId !== attempt.external_id
  ) {
    throw new TypeError("System delivery external identities disagree");
  }
  if (publicationError !== null && attempt.error !== null) {
    if (
      publicationError.code !== attempt.error.code ||
      publicationError.detail !== attempt.error.detail
    ) {
      throw new TypeError("System delivery errors disagree");
    }
  }
  if (
    row.surface === "inline_feedback" &&
    row.owner_kind === "evaluation" &&
    row.publication_status === "aggregate_only" &&
    row.target !== "aggregate_only"
  ) {
    throw new TypeError("System aggregate-only target is invalid");
  }
  if (row.owner_kind === "evaluation" && row.adjudication_id !== null) {
    throw new TypeError("System evaluation delivery owner is invalid");
  }
  if (row.owner_kind === "adjudication" && row.adjudication_id === null) {
    throw new TypeError("System adjudication delivery owner is missing");
  }
  if (row.owner_kind === "decision" && row.decision_id === null) {
    throw new TypeError("System decision delivery owner is missing");
  }
  if (
    row.owner_kind === "evaluation" &&
    row.surface === "inline_feedback" &&
    (row.finding_id === null || row.finding_evaluation_id !== row.evaluation_id)
  ) {
    throw new TypeError(
      "System inline delivery Evaluation ownership is invalid",
    );
  }
  if (
    row.owner_kind === "adjudication" &&
    (row.followup_evaluation_id !== row.evaluation_id ||
      row.adjudication_evaluation_id !== row.evaluation_id)
  ) {
    throw new TypeError("System adjudication delivery evaluation is invalid");
  }
  if (
    row.owner_kind === "decision" &&
    (row.adjudication_evaluation_id !== row.evaluation_id ||
      row.finding_evaluation_id !== row.evaluation_id ||
      row.decision_request_finding_id !== row.finding_id)
  ) {
    throw new TypeError("System decision delivery evaluation is invalid");
  }
  if (
    row.publication_status !== "aggregate_only" &&
    row.target === null &&
    hasAttempt
  ) {
    throw new TypeError("System delivery target is missing");
  }
  if (row.publication_status === "waiting" && attempt.definitive) {
    throw new TypeError("System waiting delivery is definitive");
  }
  if (
    row.publication_status === "succeeded" &&
    (attempt.attempt_count === 0 ||
      attempt.last_attempt_at === null ||
      attempt.next_attempt_at !== 0 ||
      attempt.error !== null ||
      attempt.definitive)
  ) {
    throw new TypeError("System succeeded delivery attempt is incomplete");
  }
  if (
    row.publication_status === "waiting" &&
    (attempt.external_id !== null || publicationExternalId !== null)
  ) {
    throw new TypeError("System waiting delivery has an external identity");
  }
  const externalId = publicationExternalId ?? attempt.external_id;
  if (row.publication_status === "succeeded" && externalId === null) {
    throw new TypeError("System succeeded delivery has no external identity");
  }
  if (row.publication_status === "unavailable" && externalId !== null) {
    throw new TypeError("System unavailable delivery has an external identity");
  }
  if (
    row.publication_status === "unavailable" &&
    hasAttempt &&
    (!attempt.definitive || attempt.next_attempt_at !== 0)
  ) {
    throw new TypeError(
      "System unavailable delivery attempt is not definitive",
    );
  }
  const error = publicationError ?? attempt.error;
  const activeGate = gate.until !== null && gate.until > now;
  let status;
  if (row.publication_status === "aggregate_only") {
    status = "aggregate_only";
  } else if (row.publication_status === "succeeded") {
    status = "succeeded";
  } else if (row.publication_status === "unavailable") {
    status = "unavailable";
  } else if (attempt.reconciliation_required) {
    status = "reconciling";
  } else if (activeGate || attemptNextAt > now) {
    status = "retry_scheduled";
  } else {
    status = "waiting";
  }
  const gateNextAt = activeGate ? (gate.until as number) : 0;
  const nextAttemptAt = ["waiting", "retry_scheduled", "reconciling"].includes(
    status,
  )
    ? Math.max(attemptNextAt, gateNextAt)
    : attemptNextAt;
  const definitive =
    attempt.definitive ||
    (row.publication_status === "unavailable" && !hasAttempt);
  return {
    adjudication_id: row.adjudication_id,
    attempt_count: attempt.attempt_count,
    connection_id: row.connection_id,
    decision_id: row.decision_id,
    definitive,
    error,
    evaluation_id: row.evaluation_id,
    external_id: externalId,
    finding_id: row.finding_id,
    last_attempt_at: optionalTimestamp(attempt.last_attempt_at),
    next_attempt_at: optionalNextAttemptTimestamp(nextAttemptAt),
    owner_kind: row.owner_kind,
    published_at: optionalTimestamp(publicationPublishedAt),
    provider,
    provider_gate_error: activeGate ? gate.error : null,
    provider_gate_until: activeGate ? optionalTimestamp(gate.until) : null,
    publication_status: row.publication_status,
    reconciliation_required: attempt.reconciliation_required,
    repository_id: row.repository_id,
    source_identity: row.source_identity,
    status,
    surface: row.surface,
    target: row.target,
  };
}

export function readSystemDeliveryFacts(
  durableCore: any,
  { now = () => Date.now() }: { now?: () => number } = {},
) {
  const timestampNow = now();
  if (!Number.isSafeInteger(timestampNow) || timestampNow < 0) {
    throw new TypeError("now must return a nonnegative integer timestamp");
  }
  const githubRows = readSystemDeliveryRows(durableCore, "github");
  const forgejoRows = readSystemDeliveryRows(durableCore, "forgejo");
  validateSystemDeliveryTargets(durableCore, "github");
  validateSystemDeliveryTargets(durableCore, "forgejo");
  return {
    surfaces: [
      ...githubRows.map((row) => deliverySurface(row, "github", timestampNow)),
      ...forgejoRows.map((row) =>
        deliverySurface(row, "forgejo", timestampNow),
      ),
    ].sort((left, right) =>
      `${left.provider}:${left.surface}:${left.source_identity}`.localeCompare(
        `${right.provider}:${right.surface}:${right.source_identity}`,
      ),
    ),
  };
}
