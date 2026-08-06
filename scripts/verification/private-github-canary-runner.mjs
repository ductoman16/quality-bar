const FAILURE_CODE = /^[a-z][a-z0-9_]*$/u;

/** @param {unknown} error */
function owningCode(error) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "private_github_canary_failed";
  return candidate.length <= 96 && FAILURE_CODE.test(candidate)
    ? candidate
    : "private_github_canary_failed";
}

/** @param {unknown} error */
function owningDetail(error) {
  return (
    (error instanceof Error
      ? error.message
      : "private GitHub canary failed"
    ).slice(0, 512) || "private GitHub canary failed"
  );
}

/** @param {{code: string, detail: string, now: () => number, sourceCommit: string}} input */
function failureEvidence({ code, detail, now, sourceCommit }) {
  const at = new Date(now()).toISOString();
  return {
    completedAt: at,
    failure: { code, detail },
    fixture: null,
    kind: "private-github-canary",
    observations: null,
    outcome: "fail",
    sourceCommit,
    startedAt: at,
    versions: {
      application: null,
      git: null,
      githubRest: "2026-03-10",
      node: process.version,
    },
  };
}

/**
 * @param {{
 *   canaryPath: string,
 *   invoke: () => Promise<any>,
 *   manifestPath: string,
 *   mergeEvidence: (manifest: any, canary: any) => any,
 *   now?: () => number,
 *   publish: (input: {canary: any, canaryPath: string, manifestPath: string, mergeEvidence: (manifest: any, canary: any) => any}) => void,
 *   sourceCommit: string,
 * }} input
 */
export async function runPrivateGitHubCanaryLifecycle({
  canaryPath,
  invoke,
  manifestPath,
  mergeEvidence,
  now = () => Date.now(),
  publish,
  sourceCommit,
}) {
  const attempt = failureEvidence({
    code: "private_github_canary_attempt_started",
    detail: "private GitHub canary attempt started",
    now,
    sourceCommit,
  });
  try {
    publish({
      canary: attempt,
      canaryPath,
      manifestPath,
      mergeEvidence,
    });
  } catch (error) {
    throw error instanceof Error
      ? error
      : new TypeError("private GitHub canary attempt publication failed", {
          cause: error,
        });
  }

  try {
    const canary = await invoke();
    publish({
      canary,
      canaryPath,
      manifestPath,
      mergeEvidence,
    });
    return canary;
  } catch (error) {
    const canary = failureEvidence({
      code: owningCode(error),
      detail: owningDetail(error),
      now,
      sourceCommit,
    });
    publish({
      canary,
      canaryPath,
      manifestPath,
      mergeEvidence,
    });
    return canary;
  }
}
