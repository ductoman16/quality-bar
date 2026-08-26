export function createAutomaticEvaluationAdmission(
  admitFrozenEvaluation: (transaction: any, input: any) => any,
  signalCancellations: (workIds: string[]) => void,
) {
  return (
    transaction: any,
    input: {
      changeset: any;
      provider: "forgejo" | "github";
      pullRequestNumber: number;
      repositoryId: string;
    },
  ) => {
    if (
      !transaction ||
      typeof transaction.get !== "function" ||
      typeof transaction.run !== "function" ||
      typeof input?.repositoryId !== "string" ||
      input.repositoryId.length === 0 ||
      !["forgejo", "github"].includes(input.provider)
    ) {
      throw new TypeError("Automatic Evaluation admission is invalid");
    }
    const admitted = admitFrozenEvaluation(transaction, {
      ...input,
      provenance: "automatic",
      selectors: {
        base: { type: "commit", value: input.changeset?.base_commit },
        head: { type: "commit", value: input.changeset?.head_commit },
      },
    });
    return {
      afterCommit() {
        signalCancellations(admitted.cancelledRunningReviewRunIds);
      },
      resource: admitted.resource,
    };
  };
}
