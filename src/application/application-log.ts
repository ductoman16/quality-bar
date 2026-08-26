import { randomUUID } from "node:crypto";

export function createApplicationSecretRegistry() {
  const knownSecrets: string[] = [];
  const registerSecret = (secret: string) => {
    if (secret && !knownSecrets.includes(secret)) {
      knownSecrets.push(secret);
    }
  };
  return { knownSecrets, registerSecret };
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const SAFE_OPERATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const SAFE_RESOURCE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`ordinary log ${field} is invalid`);
  }
  return value;
}

function optionalIdentifier(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`ordinary log ${field} is invalid`);
  }
  return value;
}

function optionalOperationIdentifier(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !SAFE_OPERATION_IDENTIFIER.test(value)) {
    throw new TypeError(`ordinary log ${field} is invalid`);
  }
  return value;
}

function optionalNonnegativeInteger(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`ordinary log ${field} is invalid`);
  }
  return value;
}

function redactCredentialShapes(value: string, knownSecrets: string[]) {
  let redacted = value;
  for (const secret of knownSecrets) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted
    .replaceAll(/\bBearer\s+[^\s;,]+/gi, "Bearer [REDACTED]")
    .replaceAll(/\bBasic\s+[^\s;,]+/gi, "Basic [REDACTED]")
    .replaceAll(
      /\b(?:token|password|secret|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      (match: any) => match.replace(/[:=].*$/, ": [REDACTED]"),
    )
    .replaceAll(
      /\bAuthorization\s*:\s*[^\r\n;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replaceAll(
      /\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]*?(?=(?:\s*;\s*)?(?:Set-Cookie|Cookie)\s*:|$)/gi,
      "$1: [REDACTED]",
    )
    .replaceAll(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@]+@/g, "$1[REDACTED]@")
    .replaceAll(
      /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
      "[REDACTED PEM]",
    );
}

function safeDetail(value: unknown, field: string, knownSecrets: string[]) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`ordinary log ${field} is invalid`);
  }
  return redactOrdinaryDetail(value, { knownSecrets });
}

export function redactOrdinaryDetail(
  value: string,
  { knownSecrets = [] }: { knownSecrets?: string[] } = {},
) {
  if (
    typeof value !== "string" ||
    !Array.isArray(knownSecrets) ||
    !knownSecrets.every(
      (secret) => typeof secret === "string" && secret.length > 0,
    )
  ) {
    throw new TypeError("ordinary log detail is invalid");
  }
  return redactCredentialShapes(value, knownSecrets);
}

function normalizeResourceIds(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every(
      (candidate) =>
        typeof candidate === "string" &&
        SAFE_RESOURCE_IDENTIFIER.test(candidate),
    )
  ) {
    throw new TypeError("ordinary log resource_ids are invalid");
  }
  return value;
}

function normalizeStructuredLogLine(line: string, knownSecrets: string[]) {
  if (typeof line !== "string") {
    throw new TypeError("ordinary log line is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new TypeError("ordinary log line is not JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("ordinary log record is invalid");
  }
  const record = parsed as Record<string, unknown>;
  const timestamp = requiredString(record.timestamp, "timestamp");
  const occurredAt = Date.parse(timestamp);
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new TypeError("ordinary log timestamp is invalid");
  }
  const severity = requiredString(record.severity, "severity");
  const event = requiredString(record.event, "event");
  const component = requiredString(record.component, "component");
  const outcome = requiredString(record.outcome, "outcome");
  const operation = optionalOperationIdentifier(record.operation, "operation");
  const requestId = optionalIdentifier(record.request_id, "request_id");
  const repositoryId = optionalIdentifier(
    record.repository_id,
    "repository_id",
  );
  const changesetId = optionalIdentifier(record.changeset_id, "changeset_id");
  const evaluationId = optionalIdentifier(
    record.evaluation_id,
    "evaluation_id",
  );
  const reviewRunId = optionalIdentifier(record.review_run_id, "review_run_id");
  const waiverAdjudicationId = optionalIdentifier(
    record.waiver_adjudication_id,
    "waiver_adjudication_id",
  );
  const deliverySourceId = optionalIdentifier(
    record.delivery_source_id,
    "delivery_source_id",
  );
  const applicationVersion = optionalIdentifier(
    record.application_version,
    "application_version",
  );
  const attempt = optionalNonnegativeInteger(record.attempt, "attempt");
  const durationMs = optionalNonnegativeInteger(
    record.duration_ms,
    "duration_ms",
  );
  const resourceIds = normalizeResourceIds(record.resource_ids);
  const error = safeDetail(record.error, "error", knownSecrets);
  const detail = safeDetail(record.detail, "detail", knownSecrets);
  const normalized = {
    timestamp,
    severity,
    event,
    component,
    outcome,
    ...(operation === undefined ? {} : { operation }),
    ...(requestId === undefined ? {} : { request_id: requestId }),
    ...(resourceIds === undefined ? {} : { resource_ids: resourceIds }),
    ...(attempt === undefined ? {} : { attempt }),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(error === undefined ? {} : { error }),
    ...(detail === undefined ? {} : { detail }),
    ...(repositoryId === undefined ? {} : { repository_id: repositoryId }),
    ...(changesetId === undefined ? {} : { changeset_id: changesetId }),
    ...(evaluationId === undefined ? {} : { evaluation_id: evaluationId }),
    ...(reviewRunId === undefined ? {} : { review_run_id: reviewRunId }),
    ...(waiverAdjudicationId === undefined
      ? {}
      : { waiver_adjudication_id: waiverAdjudicationId }),
    ...(deliverySourceId === undefined
      ? {}
      : { delivery_source_id: deliverySourceId }),
    ...(applicationVersion === undefined
      ? {}
      : { application_version: applicationVersion }),
  };
  return {
    line: `${JSON.stringify(normalized)}\n`,
    occurredAt,
    record: normalized,
  };
}

export function sanitizeStructuredLogLine(
  line: string,
  { knownSecrets = [] }: { knownSecrets?: string[] } = {},
) {
  if (
    !Array.isArray(knownSecrets) ||
    !knownSecrets.every(
      (secret) => typeof secret === "string" && secret.length > 0,
    )
  ) {
    throw new TypeError("ordinary log known secrets are invalid");
  }
  return normalizeStructuredLogLine(line, knownSecrets).line;
}

export function createApplicationHostLog(
  hostWriter: (line: string) => unknown,
  knownSecrets: string[] = [],
) {
  if (typeof hostWriter !== "function") {
    throw new TypeError("ordinary host log writer is invalid");
  }
  return (line: string) =>
    hostWriter(sanitizeStructuredLogLine(line, { knownSecrets }));
}

export function createApplicationLogWriter({
  hostWriter,
  readDurableCore,
  knownSecrets = [],
}: {
  hostWriter: (line: string) => unknown;
  readDurableCore: () => {
    run: (sql: string, ...parameters: any[]) => unknown;
  } | null;
  knownSecrets?: string[];
}) {
  if (
    typeof hostWriter !== "function" ||
    typeof readDurableCore !== "function" ||
    !Array.isArray(knownSecrets) ||
    !knownSecrets.every(
      (secret) => typeof secret === "string" && secret.length > 0,
    )
  ) {
    throw new TypeError("ordinary log writer dependencies are invalid");
  }
  let persisting = false;
  let persistenceFailed = false;
  return (line: string) => {
    const normalized = normalizeStructuredLogLine(line, knownSecrets);
    hostWriter(normalized.line);
    // After a durable write failure, host diagnostics remain the only
    // authorized log sink while the hard storage gate stops product work.
    if (persisting || persistenceFailed) {
      return;
    }
    const durableCore = readDurableCore();
    if (!durableCore) {
      return;
    }
    const { record } = normalized;
    persisting = true;
    try {
      durableCore.run(
        `INSERT INTO application_logs (
           id, occurred_at, severity, event, component, operation,
           attempt, duration_ms, outcome, error_code, message,
           request_id, resource_ids, repository_id, changeset_id,
           evaluation_id, review_run_id, waiver_adjudication_id,
           delivery_source_id, application_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        normalized.occurredAt,
        record.severity,
        record.event,
        record.component,
        record.operation ?? null,
        record.attempt ?? null,
        record.duration_ms ?? null,
        record.outcome,
        record.error ?? null,
        record.detail ?? record.error ?? record.event,
        record.request_id ?? null,
        record.resource_ids ? JSON.stringify(record.resource_ids) : null,
        record.repository_id ?? null,
        record.changeset_id ?? null,
        record.evaluation_id ?? null,
        record.review_run_id ?? null,
        record.waiver_adjudication_id ?? null,
        record.delivery_source_id ?? null,
        record.application_version ?? null,
      );
    } catch (error) {
      persistenceFailed = true;
      throw error;
    } finally {
      persisting = false;
    }
  };
}

export function createApplicationLog(
  hostWriter: (line: string) => unknown,
  readDurableCore: () => any,
  knownSecrets: string[] = [],
) {
  const host = createApplicationHostLog(hostWriter, knownSecrets);
  const persisted = createApplicationLogWriter({
    hostWriter,
    readDurableCore,
    knownSecrets,
  });
  return Object.assign(persisted, { host });
}
