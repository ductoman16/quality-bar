import {
  admitAutomaticEvaluations,
  completeAutomaticEvaluationAdmissions,
  releaseAutomaticEvaluationChangesets,
} from "../automatic-evaluation-admission-batch.ts";
import { requireCodedError } from "../coded-error.ts";
import { acquireForgejoAutomaticEvaluations } from "./forgejo-automatic-evaluation-admission.ts";
import { requireForgejoPollingCommit } from "./forgejo-polling-conflict.ts";
import {
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
} from "./forgejo-polling-failure.ts";
import { StorageReserveError } from "../storage-reserve.ts";

export async function reconcileForgejoAutomaticEvaluations({
  pollingCore,
  polling,
  row,
  prepared,
  generation,
  acquirePullRequestChangeset,
  admitAutomaticEvaluation,
}: {
  pollingCore: any;
  polling: any;
  row: any;
  prepared: any;
  generation: number;
  acquirePullRequestChangeset: (input: {
    pullRequest: any;
    repositoryId: string;
  }) => Promise<any>;
  admitAutomaticEvaluation: (transaction: any, input: any) => unknown;
}) {
  const acquired = await acquireForgejoAutomaticEvaluations(
    JSON.parse(row.snapshot),
    prepared.snapshots[0]?.snapshot,
    row.repository_id,
    acquirePullRequestChangeset,
  );
  const automaticEvaluations = acquired.evaluations;
  const failures = acquired.failures.map((error) => requireCodedError(error));
  for (const failure of failures) {
    Object.assign(failure, {
      attemptedAt: prepared.attemptedAt,
      repositoryId: row.forge_repository_id,
    });
  }
  const admissions: { afterCommit: () => void; resource: any }[] = [];
  const releaseAttempted = new Set();
  try {
    const interruptingFailure = failures.find(
      (failure) =>
        failure instanceof StorageReserveError ||
        failure.code === "application_shutting_down",
    );
    if (interruptingFailure) {
      throw interruptingFailure;
    }
    const failure =
      failures.find(
        (candidate) =>
          isDefinitiveForgejoPollingFailure(candidate) &&
          !isRepositoryOwnedDefinitiveForgejoPollingFailure(candidate),
      ) ??
      failures.find(isDefinitiveForgejoPollingFailure) ??
      failures[0] ??
      null;
    const committed = pollingCore.transaction((transaction: any) => {
      const admitEvaluations = () => {
        admissions.push(
          ...admitAutomaticEvaluations(
            transaction,
            automaticEvaluations,
            admitAutomaticEvaluation,
          ),
        );
        releaseAutomaticEvaluationChangesets(
          automaticEvaluations,
          releaseAttempted,
        );
      };
      const pollingCommitted = failure
        ? polling.commitFailure(
            transaction,
            row.connection_id,
            [row.forge_repository_id],
            failure,
            prepared.attemptedAt,
            false,
            generation,
            admitEvaluations,
          )
        : polling.commitSuccess(
            transaction,
            row.connection_id,
            prepared,
            generation,
          );
      if (!pollingCommitted) {
        return false;
      }
      if (!failure) {
        admitEvaluations();
      }
      return true;
    });
    requireForgejoPollingCommit(
      committed,
      "Forgejo polling changed during reconciliation",
    );
    completeAutomaticEvaluationAdmissions(admissions);
    return failure;
  } finally {
    for (const { changeset } of automaticEvaluations) {
      if (!releaseAttempted.has(changeset)) {
        changeset?.release?.();
      }
    }
  }
}
