import { currentIoOperationSignal } from "./io-operation-context.ts";

const GIT_CREDENTIAL_HELPER =
  'credential.helper=!f() { IFS= read -r username <&3; IFS= read -r password <&3; printf \'username=%s\\npassword=%s\\n\' "$username" "$password"; }; f';
const GIT_TERMINATION_GRACE_MS = 5_000;

export function gitCredentialIsValid(
  credential: { token: string; username: string } | undefined,
) {
  return (
    !credential ||
    Boolean(
      credential.username &&
      credential.token &&
      !/[\0\r\n]/.test(credential.username) &&
      !/[\0\r\n]/.test(credential.token),
    )
  );
}

export function secureGitConfiguration(
  credential: { token: string; username: string } | undefined,
  certificateAuthorityPath: string | undefined,
  followRedirects: boolean,
) {
  const arguments_ = ["-c", "credential.helper=", "-c", "core.askPass="];
  if (credential) {
    arguments_.push("-c", GIT_CREDENTIAL_HELPER);
  }
  if (certificateAuthorityPath) {
    arguments_.push("-c", `http.sslCAInfo=${certificateAuthorityPath}`);
  }
  if (!followRedirects) {
    arguments_.push("-c", "http.followRedirects=false");
  }
  return arguments_;
}

export function runGitCommand({
  arguments_,
  captureStdout,
  credential,
  cwd,
  onStderr = () => {},
  signal,
  spawnProcess,
  terminationGraceMs = GIT_TERMINATION_GRACE_MS,
}: {
  arguments_: string[];
  captureStdout: boolean;
  credential: { token: string; username: string } | undefined;
  cwd: string;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
  spawnProcess: typeof import("node:child_process").spawn;
  terminationGraceMs?: number;
}) {
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new TypeError("Git termination grace must be a nonnegative integer");
  }
  signal ??= currentIoOperationSignal();
  return new Promise((resolve, reject) => {
    let child: import("node:child_process").ChildProcess;
    try {
      signal?.throwIfAborted();
      child = spawnProcess("git", arguments_, {
        cwd,
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_LFS_SKIP_SMUDGE: "1",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
        stdio: credential
          ? ["ignore", captureStdout ? "pipe" : "ignore", "pipe", "pipe"]
          : ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
      });
    } catch (cause) {
      reject(cause);
      return;
    }
    let completed = false;
    let abortReason: unknown;
    const terminationEvidence: unknown[] = [];
    let terminationFailure: (AggregateError & { code: string }) | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    function gitTerminationFailure(): Error & { code: string } {
      terminationFailure ??= Object.assign(
        new AggregateError(
          terminationEvidence,
          "Git process termination failed",
        ),
        { code: "git_termination_failed" },
      );
      terminationFailure.errors = terminationEvidence;
      return terminationFailure;
    }
    function attemptKill(killSignal: NodeJS.Signals) {
      try {
        child.kill(killSignal);
      } catch (cause) {
        childError(cause);
      }
    }
    const abort = () => {
      abortReason = signal?.reason;
      terminationEvidence.push(abortReason);
      attemptKill("SIGTERM");
      forceKill = setTimeout(() => attemptKill("SIGKILL"), terminationGraceMs);
      forceKill.unref();
    };
    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    function cleanup() {
      if (forceKill) {
        clearTimeout(forceKill);
      }
      signal?.removeEventListener("abort", abort);
      child.removeListener("error", childError);
    }
    function complete(
      result: unknown,
      failed: boolean,
      cleanupResources: boolean = true,
    ) {
      if (completed) {
        if (cleanupResources) {
          cleanup();
        }
        return;
      }
      completed = true;
      if (cleanupResources) {
        cleanup();
      }
      if (failed) {
        reject(result);
      } else {
        resolve(result);
      }
    }
    function childError(cause: unknown) {
      if (abortReason !== undefined) {
        terminationEvidence.push(cause);
        complete(gitTerminationFailure(), true, false);
        return;
      }
      complete(cause, true, false);
    }
    child.on("error", childError);
    child.once("close", (code, exitSignal) => {
      if (abortReason !== undefined) {
        complete(
          terminationEvidence.length === 1
            ? abortReason
            : gitTerminationFailure(),
          true,
        );
        return;
      }
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      complete(
        {
          code,
          signal: exitSignal,
          stderr,
          stdout: stdoutBuffer.toString("utf8"),
          stdoutBuffer,
        },
        false,
      );
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (captureStdout && !child.stdout) {
      child.kill();
      complete(new Error("Git stdout pipe is unavailable"), true);
      return;
    }
    if (!child.stderr) {
      child.kill();
      complete(new Error("Git stderr pipe is unavailable"), true);
      return;
    }
    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      const message = String(chunk);
      stderr = `${stderr}${message}`.slice(-1024);
      onStderr(message);
    });
    if (credential) {
      const credentialPipe = child.stdio[3];
      if (!credentialPipe || !("end" in credentialPipe)) {
        child.kill();
        complete(new Error("Git credential pipe is unavailable"), true);
        return;
      }
      // Git's exit status owns the command result. A rejected pipe write only
      // means Git exited before requesting credentials.
      credentialPipe.on("error", () => {});
      credentialPipe.end(`${credential.username}\n${credential.token}\n`);
    }
  });
}
