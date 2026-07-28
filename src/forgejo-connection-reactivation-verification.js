import { verifiedForgejoRepositories } from "./forgejo-connection-rotation.js";

const REQUIRED_CAPABILITIES = [
  "aggregate_feedback",
  "branch_access",
  "commit_status",
  "enumeration",
  "inline_feedback",
  "private_git_read",
  "pull_request_access",
];
const REQUIRED_SCOPES = ["read:repository", "write:issue", "write:repository"];

/** @returns {never} */
function invalid() {
  throw Object.assign(new Error("Forgejo verification result is invalid"), {
    code: "forgejo_verification_result_invalid",
  });
}

/** @param {any} verification @param {number[]} repositoryIds */
export function completeForgejoReactivationVerification(
  verification,
  repositoryIds,
) {
  const result = verifiedForgejoRepositories(verification, repositoryIds);
  const capabilityEntries =
    result?.capabilities &&
    typeof result.capabilities === "object" &&
    !Array.isArray(result.capabilities)
      ? Object.entries(result.capabilities)
      : [];
  if (
    result?.profile !== "forgejo-v16" ||
    typeof result.reported_version !== "string" ||
    !/^16\.\d+\.\d+$/.test(result.reported_version) ||
    !result.principal ||
    !Number.isSafeInteger(result.principal.id) ||
    typeof result.principal.login !== "string" ||
    result.principal.login.length === 0 ||
    !Array.isArray(result.scopes) ||
    result.scopes.length !== REQUIRED_SCOPES.length ||
    !REQUIRED_SCOPES.every((scope) => result.scopes.includes(scope)) ||
    capabilityEntries.length !== REQUIRED_CAPABILITIES.length ||
    !REQUIRED_CAPABILITIES.every(
      (capability) => result.capabilities[capability] === "verified",
    )
  ) {
    invalid();
  }
  return result;
}
