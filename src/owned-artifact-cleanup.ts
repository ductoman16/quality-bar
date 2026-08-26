import { lstatSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const TERMINAL_STATUSES = new Set(["cancelled", "completed", "failed"]);
const WORK_ID = /^[A-Za-z0-9._-]+$/;
const FENCING_TOKEN = /^[1-9][0-9]*$/;

export class OwnedArtifactCleanupError extends Error {
  name: "OwnedArtifactCleanupError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OwnedArtifactCleanupError";
    this.code = code;
  }
}

function cleanupFailure(code: string, message: string, cause: unknown) {
  return new OwnedArtifactCleanupError(code, message, { cause });
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function readEntries(path: string) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch (cause) {
    throw cleanupFailure(
      "owned_artifact_cleanup_root_read_failed",
      "Owned temporary artifact root could not be read",
      cause,
    );
  }
}

function readOwners(durableCore: any) {
  let rows;
  try {
    rows = durableCore.all(
      `SELECT queue.work_id, queue.fencing_token,
              CASE queue.work_kind
                WHEN 'review_run' THEN review_runs.execution_status
                WHEN 'waiver_adjudication' THEN waiver_adjudications.execution_status
              END AS execution_status
       FROM codex_execution_queue AS queue
       LEFT JOIN review_runs
         ON queue.work_kind = 'review_run' AND review_runs.id = queue.work_id
       LEFT JOIN waiver_adjudications
         ON queue.work_kind = 'waiver_adjudication'
        AND waiver_adjudications.id = queue.work_id`,
    );
  } catch (cause) {
    throw cleanupFailure(
      "owned_artifact_cleanup_owner_read_failed",
      "Owned temporary artifact owners could not be read",
      cause,
    );
  }
  if (!Array.isArray(rows)) {
    throw new OwnedArtifactCleanupError(
      "owned_artifact_cleanup_owner_invalid",
      "Owned temporary artifact owner state is invalid",
    );
  }
  const owners = new Map();
  for (const row of rows) {
    if (
      !WORK_ID.test(row?.work_id) ||
      !Number.isSafeInteger(row?.fencing_token) ||
      row.fencing_token < 0 ||
      !["queued", "running", "cancelled", "completed", "failed"].includes(
        row?.execution_status,
      )
    ) {
      throw new OwnedArtifactCleanupError(
        "owned_artifact_cleanup_owner_invalid",
        "Owned temporary artifact owner state is invalid",
      );
    }
    owners.set(row.work_id, row);
  }
  return owners;
}

function removeArtifact(path: string) {
  try {
    rmSync(path, { force: true, recursive: true });
  } catch (cause) {
    throw cleanupFailure(
      "owned_artifact_cleanup_remove_failed",
      "Owned temporary artifact could not be removed",
      cause,
    );
  }
}

function removeIfEmpty(path: string) {
  try {
    rmdirSync(path);
  } catch (cause) {
    if (
      isMissing(cause) ||
      (cause instanceof Error && "code" in cause && cause.code === "ENOTEMPTY")
    ) {
      return;
    }
    throw cleanupFailure(
      "owned_artifact_cleanup_remove_failed",
      "Owned temporary artifact could not be removed",
      cause,
    );
  }
}

function isDirectory(path: string) {
  try {
    return lstatSync(path).isDirectory();
  } catch (cause) {
    if (isMissing(cause)) {
      return false;
    }
    throw cleanupFailure(
      "owned_artifact_cleanup_root_read_failed",
      "Owned temporary artifact root could not be read",
      cause,
    );
  }
}

function removeSupersededLeases(workPath: string, fencingToken: number) {
  if (fencingToken === 0 || !isDirectory(workPath)) {
    return;
  }
  for (const entry of readEntries(workPath)) {
    if (!FENCING_TOKEN.test(entry.name)) {
      continue;
    }
    const token = Number(entry.name);
    if (Number.isSafeInteger(token) && token < fencingToken) {
      removeArtifact(join(workPath, entry.name));
    }
  }
  removeIfEmpty(workPath);
}

export function cleanupOwnedTemporaryArtifacts({
  checkoutRoot,
  durableCore,
}: {
  checkoutRoot: string;
  durableCore: { all: (sql: string) => unknown[] };
}) {
  if (!isAbsolute(checkoutRoot) || typeof durableCore?.all !== "function") {
    throw new TypeError(
      "Owned temporary artifact cleanup dependencies are invalid",
    );
  }
  const owners = readOwners(durableCore);
  let removed = 0;
  for (const entry of readEntries(checkoutRoot)) {
    if (!WORK_ID.test(entry.name)) {
      continue;
    }
    const workPath = join(checkoutRoot, entry.name);
    const owner = owners.get(entry.name);
    if (!owner || TERMINAL_STATUSES.has(owner.execution_status)) {
      removeArtifact(workPath);
      removed += 1;
      continue;
    }
    removeSupersededLeases(workPath, owner.fencing_token);
  }
  return { removed };
}
