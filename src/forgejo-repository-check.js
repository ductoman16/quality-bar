/** @param {Error & {repositoryChecks?: unknown}} error @param {number[]} repositoryIds */
export function failedForgejoRepositoryChecks(error, repositoryIds) {
  if (error.repositoryChecks === undefined) {
    return repositoryIds.map((repositoryId) => ({
      forge_repository_id: repositoryId,
      outcome: "not_completed",
    }));
  }
  if (!Array.isArray(error.repositoryChecks)) {
    throw new TypeError("Forgejo Repository verification checks are invalid");
  }
  const checkedIds = new Set();
  for (const candidate of error.repositoryChecks) {
    if (
      !candidate ||
      Array.isArray(candidate) ||
      typeof candidate !== "object"
    ) {
      throw new TypeError("Forgejo Repository verification checks are invalid");
    }
    const check = /** @type {Record<string, unknown>} */ (candidate);
    const repositoryId = check.forge_repository_id;
    const outcome = check.outcome;
    const hasPermissions = "permissions" in check;
    const exactKeys =
      outcome === "error"
        ? [
            "error",
            "forge_repository_id",
            "outcome",
            ...(hasPermissions ? ["permissions"] : []),
          ]
        : [
            "forge_repository_id",
            "outcome",
            ...(hasPermissions ? ["permissions"] : []),
          ];
    const codedError =
      check.error &&
      !Array.isArray(check.error) &&
      typeof check.error === "object"
        ? /** @type {Record<string, unknown>} */ (check.error)
        : null;
    if (
      !Number.isSafeInteger(repositoryId) ||
      !repositoryIds.includes(/** @type {number} */ (repositoryId)) ||
      checkedIds.has(repositoryId) ||
      !["error", "not_completed"].includes(/** @type {string} */ (outcome)) ||
      Object.keys(check).sort().join(",") !== exactKeys.join(",") ||
      (hasPermissions && !verifiedPermissions(check.permissions)) ||
      (outcome === "error" &&
        (!codedError ||
          Object.keys(codedError).sort().join(",") !== "code,message" ||
          typeof codedError.code !== "string" ||
          codedError.code.length === 0 ||
          typeof codedError.message !== "string" ||
          codedError.message.length === 0))
    ) {
      throw new TypeError("Forgejo Repository verification checks are invalid");
    }
    checkedIds.add(repositoryId);
  }
  if (
    checkedIds.size !== repositoryIds.length ||
    repositoryIds.some((repositoryId) => !checkedIds.has(repositoryId))
  ) {
    throw new TypeError("Forgejo Repository verification checks are invalid");
  }
  return error.repositoryChecks;
}

/** @param {unknown} value */
function verifiedPermissions(value) {
  const permissions = object(value);
  return (
    permissions &&
    Object.keys(permissions).sort().join(",") === "admin,pull,push" &&
    permissions.admin === true &&
    permissions.pull === true &&
    permissions.push === true
  );
}

/** @param {unknown} value @param {boolean} succeeded */
export function verifiedForgejoRepositoryEvidence(value, succeeded) {
  if (!Array.isArray(value)) {
    throw new TypeError("Forgejo Repository verification evidence is invalid");
  }
  if (!succeeded) {
    const successful = value.filter((candidate) => {
      const evidence = object(candidate);
      return evidence?.outcome === "success" && "id" in evidence;
    });
    const incomplete = value.filter(
      (candidate) => !successful.includes(candidate),
    );
    verifiedForgejoRepositoryEvidence(successful, true);
    const repositoryIds = incomplete.map((candidate) =>
      Number(object(candidate)?.forge_repository_id),
    );
    failedForgejoRepositoryChecks(
      Object.assign(new Error("Forgejo verification failed"), {
        repositoryChecks: incomplete,
      }),
      repositoryIds,
    );
    const evidenceIds = value.map((candidate) => {
      const evidence = object(candidate);
      return evidence?.id ?? evidence?.forge_repository_id;
    });
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new TypeError(
        "Forgejo Repository verification evidence is invalid",
      );
    }
    return value;
  }
  for (const candidate of value) {
    const repository = object(candidate);
    if (
      !repository ||
      Object.keys(repository).sort().join(",") !==
        "api_url,clone_url,full_name,html_url,id,outcome,permissions,private" ||
      !Number.isSafeInteger(repository.id) ||
      Number(repository.id) <= 0 ||
      repository.outcome !== "success" ||
      !verifiedPermissions(repository.permissions) ||
      typeof repository.private !== "boolean" ||
      ["api_url", "clone_url", "full_name", "html_url"].some(
        (field) =>
          typeof repository[field] !== "string" ||
          /** @type {string} */ (repository[field]).length === 0,
      )
    ) {
      throw new TypeError(
        "Forgejo Repository verification evidence is invalid",
      );
    }
  }
  return value;
}

/** @param {unknown} value */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}
