export function requireForgejoPollingCommit(
  committed: boolean,
  message: string,
) {
  if (!committed) {
    throw Object.assign(new Error(message), {
      code: "forgejo_polling_conflict",
    });
  }
}
