export type ReviewRunCodexOptions = {
  cancellationSignal?: Promise<void>;
  checkoutPath: string;
  claim: { fencingToken: number; workerId: string; workId: string };
  codexCommand?: string;
  codexPrefixArguments?: string[];
  submissionMode?: "review-file" | "generic";
  openSubmissionChannel?: (
    claim: any,
    resultService: any,
    options: {
      checkoutPath: string;
      submissionMode?: "review-file" | "generic";
    },
  ) => Promise<{
    accepted(): boolean;
    bindProcessGroup(processGroupId: number): void;
    close(): Promise<void>;
    commandDirectory: string;
    environment: Record<string, string>;
    failure(): Error | null;
    hasCommittedSubmission?(): boolean;
    hasPendingSubmission?(): boolean;
    lastValidationFailure():
      | import("./review-run-result.ts").ReviewRunExecutionError
      | null;
    stop?(): Promise<void>;
    waitForResult(): Promise<"accepted" | "failed">;
    waitForPendingSubmission?(): Promise<"accepted" | "failed">;
  }>;
  resultService: { prepare(claim: any, candidate: unknown): unknown };
  recordDeadline: (
    failure: import("./review-run-result.ts").ReviewRunExecutionError,
  ) => unknown;
  startProcessGroup: (processGroupId: number) => unknown;
  finishProcessGroup: () => unknown;
  run: unknown;
  processEnvironment?: NodeJS.ProcessEnv;
  terminateOnParentDisconnect?: boolean;
  clearDeadlineTimer?: (timer: any) => void;
  clearTerminationTimer?: (timer: any) => void;
  evidenceService?: {
    appendTranscriptChunk(
      claim: any,
      stream: "stdout" | "stderr",
      content: string,
    ): unknown;
    complete(claim: any, facts: unknown): unknown;
  };
  killProcessGroup?: (pid: number, signal: NodeJS.Signals | 0) => void;
  setDeadlineTimer?: (callback: () => void, milliseconds: number) => any;
  setTerminationTimer?: (callback: () => void, milliseconds: number) => any;
  spawnProcess?: (
    command: string,
    arguments_: string[],
    options: import("node:child_process").SpawnOptions,
  ) => import("node:child_process").ChildProcess;
  prepareProcess?: typeof import("../codex/codex-process-supervisor.ts").prepareCodexProcess;
  observeProcess?: typeof import("../codex/codex-process-supervisor.ts").observeSupervisedCodexProcess;
};

export {};
