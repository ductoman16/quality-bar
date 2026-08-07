/**
 * @param {unknown} error
 * @param {string} identity
 */
export function isUniqueConstraintFailure(error, identity) {
  return (
    error instanceof Error &&
    error.message.includes(`UNIQUE constraint failed: ${identity}`)
  );
}
