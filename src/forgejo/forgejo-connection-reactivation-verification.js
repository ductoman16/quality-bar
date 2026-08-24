import { verifiedForgejoRepositories } from "./forgejo-connection-rotation.js";
import { verifiedForgejoRepositoryEvidence } from "./forgejo-repository-check.js";
import {
  FORGEJO_CAPABILITY_NAMES,
  VERIFIED_FORGEJO_AUTHORITIES,
} from "./forgejo-evidence.js";

const REQUIRED_CAPABILITIES = FORGEJO_CAPABILITY_NAMES;
const REQUIRED_SCOPES = VERIFIED_FORGEJO_AUTHORITIES;

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
    result?.profile !== "forgejo" ||
    typeof result.reported_version !== "string" ||
    !/^16\.\d+\.\d+(?:\+gitea-\d+\.\d+\.\d+)?$/.test(result.reported_version) ||
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
    ) ||
    result.repositories.some(
      /** @param {any} repository */
      (repository) =>
        repository.permissions?.admin !== true ||
        repository.permissions?.pull !== true ||
        repository.permissions?.push !== true,
    )
  ) {
    invalid();
  }
  return result;
}

/** @param {Error & {verificationEvidence?: unknown}} error @param {number[]} repositoryIds */
export function failedForgejoReactivationVerification(error, repositoryIds) {
  if (error.verificationEvidence === undefined) {
    return null;
  }
  const result =
    error.verificationEvidence &&
    !Array.isArray(error.verificationEvidence) &&
    typeof error.verificationEvidence === "object"
      ? /** @type {any} */ (error.verificationEvidence)
      : null;
  const capabilityEntries =
    result?.capabilities &&
    !Array.isArray(result.capabilities) &&
    typeof result.capabilities === "object"
      ? Object.entries(result.capabilities)
      : [];
  if (
    !result ||
    Object.keys(result).sort().join(",") !==
      "capabilities,principal,profile,reported_version,repositories,scopes" ||
    ![null, "forgejo"].includes(result.profile) ||
    (result.reported_version !== null &&
      (typeof result.reported_version !== "string" ||
        !/^16\.\d+\.\d+(?:\+gitea-\d+\.\d+\.\d+)?$/.test(
          result.reported_version,
        ))) ||
    (result.principal !== null &&
      (!Number.isSafeInteger(result.principal?.id) ||
        typeof result.principal?.login !== "string" ||
        result.principal.login.length === 0)) ||
    (result.scopes !== null &&
      (!Array.isArray(result.scopes) ||
        result.scopes.length !== REQUIRED_SCOPES.length ||
        !REQUIRED_SCOPES.every((scope) => result.scopes.includes(scope)))) ||
    (result.capabilities !== null &&
      (capabilityEntries.length !== REQUIRED_CAPABILITIES.length ||
        !REQUIRED_CAPABILITIES.every((capability) =>
          ["error", "not_completed", "verified"].includes(
            result.capabilities[capability],
          ),
        )))
  ) {
    invalid();
  }
  const repositories = verifiedForgejoRepositoryEvidence(
    result.repositories,
    false,
  );
  const evidenceIds = repositories.map(
    (repository) => repository.id ?? repository.forge_repository_id,
  );
  if (
    evidenceIds.length !== repositoryIds.length ||
    repositoryIds.some((repositoryId) => !evidenceIds.includes(repositoryId))
  ) {
    invalid();
  }
  return {
    ...result,
    repositories,
  };
}
