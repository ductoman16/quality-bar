function fail(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw Object.assign(new Error(message), { code }, details);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function principal(value: unknown) {
  const candidate = object(value);
  const id = candidate?.id;
  const login = candidate?.login;
  if (
    !candidate ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof login !== "string" ||
    login.length === 0
  ) {
    fail("forgejo_principal_invalid", "Forgejo principal response is invalid");
  }
  return { id, login };
}

export function forgejoRepositoryOwner(value: unknown) {
  return principal(object(value)?.owner);
}

export function forgejoRepository(value: unknown) {
  const candidate = object(value);
  const permissions = object(candidate?.permissions);
  const evidence = {
    api_url: candidate?.url,
    clone_url: candidate?.clone_url,
    full_name: candidate?.full_name,
    html_url: candidate?.html_url,
    id: candidate?.id,
    permissions: {
      admin: permissions?.admin,
      pull: permissions?.pull,
      push: permissions?.push,
    },
    private: candidate?.private,
  };
  if (
    !candidate ||
    typeof evidence.id !== "number" ||
    !Number.isSafeInteger(evidence.id) ||
    evidence.id <= 0 ||
    !Object.values(evidence).every(
      (field) =>
        field !== undefined &&
        (typeof field === "string" ? field.length > 0 : true),
    ) ||
    typeof evidence.private !== "boolean" ||
    !permissions ||
    permissions.pull !== true ||
    permissions.push !== true ||
    permissions.admin !== true
  ) {
    fail(
      "forgejo_repository_capability_missing",
      "Forgejo Repository does not have the required Forgejo authority",
      Number.isSafeInteger(evidence.id) && Number(evidence.id) > 0
        ? { repositoryId: evidence.id }
        : {},
    );
  }
  return evidence as {
    api_url: string;
    clone_url: string;
    full_name: string;
    html_url: string;
    id: number;
    permissions: { admin: true; pull: true; push: true };
    private: boolean;
  };
}

export function requireForgejoRepositoryAuthority(
  value: unknown,
  expectedId: number,
) {
  const candidate = object(value);
  const permissions = object(candidate?.permissions);
  if (
    !candidate ||
    candidate.id !== expectedId ||
    !permissions ||
    permissions.pull !== true ||
    permissions.push !== true ||
    permissions.admin !== true
  ) {
    fail(
      "forgejo_repository_capability_missing",
      "Forgejo Repository does not have the required Forgejo authority",
    );
  }
}

export function missingForgejoRepositorySelection(
  selected: (Record<string, any> | undefined)[],
  repositoryIds: number[],
) {
  const missingRepositoryIds = selected.flatMap((candidate, index) =>
    candidate ? [] : [repositoryIds[index]],
  );
  const error = {
    code: "forgejo_repository_selection_unavailable",
    message: "Selected Forgejo Repository is not accessible to the Connection",
  };
  return {
    error: Object.assign(new Error(error.message), {
      code: error.code,
      ...(missingRepositoryIds.length === 1
        ? { repositoryId: missingRepositoryIds[0] }
        : {}),
      repositoryIds: missingRepositoryIds,
    }),
    repositories: selected.map((candidate, index) =>
      candidate
        ? {
            forge_repository_id: repositoryIds[index],
            outcome: "not_completed",
            permissions: candidate.permissions,
          }
        : {
            error,
            forge_repository_id: repositoryIds[index],
            outcome: "error",
          },
    ),
  };
}
