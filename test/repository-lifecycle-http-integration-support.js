import assert from "node:assert/strict";

/**
 * @param {Response} response
 * @param {{code?: string, current: unknown, message?: string}} expected
 */
export async function assertRepositoryConflict(
  response,
  {
    code = "github_repository_enablement_conflict",
    current,
    message = "GitHub Repository changed during reactivation",
  },
) {
  assert.equal(response.status, 409);
  const body = /** @type {any} */ (await response.json());
  assert.deepEqual(body.current, current);
  assert.equal(body.error.code, code);
  assert.equal(body.error.message, message);
  assert.equal(typeof body.error.request_id, "string");
}
