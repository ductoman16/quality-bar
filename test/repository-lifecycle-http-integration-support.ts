import assert from "node:assert/strict";

export async function assertRepositoryConflict(
  response: Response,
  {
    code = "github_repository_enablement_conflict",
    current,
    message = "GitHub Repository changed during reactivation",
  }: { code?: string; current: unknown; message?: string },
) {
  assert.equal(response.status, 409);
  const body = (await response.json()) as any;
  assert.deepEqual(body.current, current);
  assert.equal(body.error.code, code);
  assert.equal(body.error.message, message);
  assert.equal(typeof body.error.request_id, "string");
}
