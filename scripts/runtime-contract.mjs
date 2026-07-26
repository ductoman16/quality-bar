export const REQUIRED_NODE_VERSION = "v24.18.0";

export function assertExactNodeRuntime(executingVersion) {
  if (executingVersion !== REQUIRED_NODE_VERSION) {
    throw new Error(
      `verification_runtime_mismatch: expected ${REQUIRED_NODE_VERSION}, received ${executingVersion}`,
    );
  }
}
