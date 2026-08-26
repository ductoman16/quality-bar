export async function withAcquiredChangeset(
  acquire: (repositoryId: string, request: any) => Promise<any>,
  repositoryId: string,
  request: any,
  use: (changeset: any, release: () => void) => any,
) {
  const changeset = await acquire(repositoryId, request);
  let releaseAttempted = false;
  const release = () => {
    if (releaseAttempted) {
      throw new TypeError("Acquired Changeset release was already attempted");
    }
    releaseAttempted = true;
    if (
      changeset &&
      "release" in changeset &&
      typeof changeset.release === "function"
    ) {
      changeset.release();
    }
  };
  try {
    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(changeset?.base_commit) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(changeset?.head_commit) ||
      changeset.base_commit.length !== changeset.head_commit.length
    ) {
      throw new TypeError("Acquired Evaluation commits are invalid");
    }
    return use(changeset, release);
  } finally {
    if (!releaseAttempted) {
      release();
    }
  }
}
