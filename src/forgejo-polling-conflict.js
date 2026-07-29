/** @param {boolean} committed @param {string} message */
export function requireForgejoPollingCommit(committed, message) {
  if (!committed) {
    throw Object.assign(new Error(message), {
      code: "forgejo_polling_conflict",
    });
  }
}
