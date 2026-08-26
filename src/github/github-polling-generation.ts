export function readGitHubPollingGeneration(
  core: { all: Function },
  connectionId: string,
) {
  const [row] = core.all(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    `github_poll_generation:${connectionId}`,
  );
  if (!row) {
    return 0;
  }
  if (
    typeof row.value !== "string" ||
    !/^(0|[1-9]\d*)$/u.test(row.value) ||
    !Number.isSafeInteger(Number(row.value))
  ) {
    throw new TypeError("GitHub polling generation is invalid");
  }
  return Number(row.value);
}

export function claimGitHubPollingGeneration(
  transaction: { all: Function; run: Function },
  connectionId: string,
  expectedGeneration: number | undefined,
) {
  const current = readGitHubPollingGeneration(transaction, connectionId);
  if (expectedGeneration !== undefined && current !== expectedGeneration) {
    return false;
  }
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("GitHub polling generation is exhausted");
  }
  transaction.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    `github_poll_generation:${connectionId}`,
    String(current + 1),
  );
  return true;
}
