/**
 * @typedef {{
 *   cancellationSignal?: Promise<void>,
 *   checkoutPath: string,
 *   claim: {fencingToken: number, workerId: string, workId: string},
 *   codexCommand?: string,
 *   codexPrefixArguments?: string[],
 *   openSubmissionChannel?: (
 *     claim: any,
 *     resultService: any
 *   ) => Promise<{
 *     accepted(): boolean,
 *     close(): Promise<void>,
 *     commandDirectory: string,
 *     environment: Record<string, string>,
 *     failure(): Error | null,
 *     lastValidationFailure(): import("./review-run-result.js").ReviewRunExecutionError | null,
 *     waitForResult(): Promise<"accepted" | "failed">
 *   }>,
 *   resultService: {prepare(claim: any, candidate: unknown): unknown},
 *   recordDeadline: (failure: import("./review-run-result.js").ReviewRunExecutionError) => unknown,
 *   startProcessGroup: (processGroupId: number) => unknown,
 *   finishProcessGroup: () => unknown,
 *   run: unknown,
 *   processEnvironment?: NodeJS.ProcessEnv,
 *   clearDeadlineTimer?: (timer: any) => void,
 *   clearTerminationTimer?: (timer: any) => void,
 *   evidenceService?: {appendTranscriptChunk(claim: any, stream: "stdout" | "stderr", content: string): unknown, complete(claim: any, facts: unknown): unknown},
 *   killProcessGroup?: (pid: number, signal: NodeJS.Signals | 0) => void,
 *   setDeadlineTimer?: (callback: () => void, milliseconds: number) => any,
 *   setTerminationTimer?: (callback: () => void, milliseconds: number) => any,
 *   spawnProcess?: (
 *     command: string,
 *     arguments_: string[],
 *     options: import("node:child_process").SpawnOptions
 *   ) => import("node:child_process").ChildProcess,
 *   prepareProcess?: typeof import("./codex-process-supervisor.js").prepareCodexProcess,
 *   observeProcess?: typeof import("./codex-process-supervisor.js").observeSupervisedCodexProcess
 * }} ReviewRunCodexOptions
 */

export {};
