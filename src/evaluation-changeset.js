/**
 * @param {(repositoryId: string, request: any) => Promise<any>} acquire
 * @param {string} repositoryId
 * @param {any} request
 * @param {(changeset: any) => any} use
 */
export async function withAcquiredChangeset(
  acquire,
  repositoryId,
  request,
  use,
) {
  const changeset = await acquire(repositoryId, request);
  try {
    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(changeset?.base_commit) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(changeset?.head_commit) ||
      changeset.base_commit.length !== changeset.head_commit.length
    ) {
      throw new TypeError("Acquired Evaluation commits are invalid");
    }
    return use(changeset);
  } finally {
    if (
      changeset &&
      "release" in changeset &&
      typeof changeset.release === "function"
    ) {
      changeset.release();
    }
  }
}
