export function isUniqueConstraintFailure(error: unknown, identity: string) {
  return (
    error instanceof Error &&
    error.message.includes(`UNIQUE constraint failed: ${identity}`)
  );
}
