import { spawn } from "node:child_process";

import { createApplicationIoPool } from "./application-io-pool.ts";
import { structuredLog } from "./application-runtime.ts";

function codedRuntimeFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return Object.assign(new TypeError("I/O duty failed with a non-error"), {
      code: "io_execution_failed",
    });
  }
  if (!("code" in error) || typeof error.code !== "string") {
    Object.defineProperty(error, "code", {
      configurable: true,
      value: "io_execution_failed",
    });
  }
  return error as Error & { code: string };
}

function readExecutionCorrelation(durableCore: any, claim: any) {
  if (
    (claim?.workKind !== "review_run" &&
      claim?.workKind !== "waiver_adjudication") ||
    typeof durableCore?.get !== "function"
  ) {
    return {};
  }
  const ownerCorrelation =
    claim.workKind === "review_run"
      ? { reviewRunId: claim.workId }
      : { waiverAdjudicationId: claim.workId };
  const table =
    claim.workKind === "review_run" ? "review_runs" : "waiver_adjudications";
  try {
    const row = durableCore.get(
      `SELECT ${table}.evaluation_id, evaluations.repository_id
       FROM ${table}
       JOIN evaluations ON evaluations.id = ${table}.evaluation_id
       WHERE ${table}.id = ?`,
      claim.workId,
    );
    return {
      ...ownerCorrelation,
      ...(typeof row?.repository_id === "string"
        ? { repositoryId: row.repository_id }
        : {}),
      ...(typeof row?.evaluation_id === "string"
        ? { evaluationId: row.evaluation_id }
        : {}),
    };
  } catch {
    return ownerCorrelation;
  }
}

export function createApplicationExecutionRuntime({
  certificateAuthorityPath,
  createCodexRuntime,
  now,
  spawnProcess: spawnChild = spawn,
  stopIoDuties,
  storageBoundary,
  writeLog,
}: {
  certificateAuthorityPath?: string;
  createCodexRuntime: (...parameters: any[]) => any;
  now: () => number;
  spawnProcess?: typeof spawn;
  stopIoDuties: () => unknown;
  storageBoundary: ReturnType<
    typeof import("./application-runtime.ts").createHardStorageBoundary
  >;
  writeLog: (line: string) => unknown;
}) {
  let failure: (Error & { code: string }) | null = null;
  const ioPool = createApplicationIoPool({
    reportBackgroundFailure(error) {
      const backgroundFailure = codedRuntimeFailure(error);
      if (backgroundFailure.code === "application_shutting_down") {
        return;
      }
      structuredLog(
        writeLog,
        backgroundFailure.code === "io_execution_capacity_unavailable"
          ? "warning"
          : "error",
        "io_duty_failed",
        "io",
        "failure",
        backgroundFailure,
      );
      if (
        backgroundFailure.code !== "io_execution_capacity_unavailable" &&
        !failure
      ) {
        failure = backgroundFailure;
        stopIoDuties();
      }
    },
  });

  return {
    get failure() {
      return failure;
    },
    ioPool,
    createCodexRuntime(
      durableCore: any,
      repositories: any,
      storageReserve: any,
    ) {
      return createCodexRuntime(durableCore, {
        certificateAuthorityPath,
        ioPool,
        now,
        repositories,
        storageReserve,
        reportFailure(error: unknown, claim: any) {
          const codexFailure = codedRuntimeFailure(error);
          structuredLog(
            writeLog,
            "error",
            "codex_execution_failed",
            "codex",
            "failure",
            codexFailure,
            readExecutionCorrelation(durableCore, claim),
          );
          if (!claim) {
            if (!failure) {
              failure = codexFailure;
              stopIoDuties();
            }
          }
        },
        spawnProcess(
          command: string,
          arguments_: string[],
          spawnOptions: import("node:child_process").SpawnOptions,
        ) {
          const childProcess = spawnChild(command, arguments_, spawnOptions);
          storageBoundary.registerCodexProcess(childProcess, {
            processGroup: spawnOptions.detached === true,
          });
          return childProcess;
        },
      });
    },
  };
}
