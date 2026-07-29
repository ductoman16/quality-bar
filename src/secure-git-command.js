const GIT_CREDENTIAL_HELPER =
  'credential.helper=!f() { IFS= read -r username <&3; IFS= read -r password <&3; printf \'username=%s\\npassword=%s\\n\' "$username" "$password"; }; f';

/** @param {{token: string, username: string} | undefined} credential */
export function gitCredentialIsValid(credential) {
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

/**
 * @param {{token: string, username: string} | undefined} credential
 * @param {string | undefined} certificateAuthorityPath
 * @param {boolean} followRedirects
 */
export function secureGitConfiguration(
  credential,
  certificateAuthorityPath,
  followRedirects,
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

/**
 * @param {{
 *   arguments_: string[],
 *   captureStdout: boolean,
 *   credential: {token: string, username: string} | undefined,
 *   cwd: string,
 *   onStderr?: (chunk: string) => void,
 *   spawnProcess: typeof import("node:child_process").spawn
 * }} input
 */
export function runGitCommand({
  arguments_,
  captureStdout,
  credential,
  cwd,
  onStderr = () => {},
  spawnProcess,
}) {
  return new Promise((resolve, reject) => {
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
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
    /** @type {Buffer[]} */
    const stdoutChunks = [];
    let stderr = "";
    /** @param {unknown} result @param {boolean} failed */
    function complete(result, failed) {
      if (completed) {
        return;
      }
      completed = true;
      if (failed) {
        reject(result);
      } else {
        resolve(result);
      }
    }
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
    child.once("error", (cause) => {
      complete(cause, true);
    });
    child.once("close", (code, signal) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      complete(
        {
          code,
          signal,
          stderr,
          stdout: stdoutBuffer.toString("utf8"),
          stdoutBuffer,
        },
        false,
      );
    });
  });
}
