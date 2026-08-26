import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forgejoDefinitiveFailureScope,
  forgejoFailureRepositoryIds,
} from "../src/forgejo/forgejo-failure.ts";
import { updateForgejoConnectionFailureHealth } from "../src/forgejo/forgejo-failure-health.ts";
import { recordForgejoPollingOwningFailure } from "../src/forgejo/forgejo-polling-owning-failure.ts";

test("Forgejo definitive failures gate only their exact owning resource", () => {
  for (const code of [
    "forgejo_connection_credential_invalid",
    "forgejo_openapi_invalid",
    "forgejo_poll_response_invalid",
    "forgejo_publication_capability_unavailable",
    "forgejo_required_route_invalid",
    "forgejo_required_route_unavailable",
    "forgejo_version_unsupported",
    "repository_authentication_failed",
  ]) {
    assert.equal(forgejoDefinitiveFailureScope({ code }), "connection", code);
  }
  for (const code of [
    "forgejo_repository_api_access_failed",
    "forgejo_repository_capability_missing",
    "forgejo_repository_permission_denied",
    "forgejo_repository_selection_unavailable",
    "repository_git_read_failed",
    "repository_permission_denied",
  ]) {
    assert.equal(
      forgejoDefinitiveFailureScope({ code, repositoryId: 101 }),
      "repository",
      code,
    );
  }
  assert.equal(
    forgejoDefinitiveFailureScope({
      code: "forgejo_repository_selection_unavailable",
      repositoryIds: [101, 202],
    }),
    "repository",
  );
});

test("Repository verification failure preserves existing Connection health", () => {
  let parameters: unknown[] = [];
  let statement = "";
  updateForgejoConnectionFailureHealth(
    {
      run(sql: string, ...values: Array<unknown>) {
        statement = sql;
        parameters = values;
        return { changes: 1 };
      },
    },
    "connection-1",
    "repository",
    25,
  );
  assert.deepEqual(parameters, [
    "repository",
    "repository",
    25,
    "connection-1",
  ]);
  assert.doesNotMatch(statement, /THEN 'healthy'/);
});

test("polling rejects a Repository failure whose owner is not selected", () => {
  assert.throws(
    () =>
      recordForgejoPollingOwningFailure(
        { run: () => assert.fail("must not write an inconsistent owner") },
        "connection-1",
        [101],
        Object.assign(new Error("denied"), {
          code: "forgejo_repository_permission_denied",
          repositoryId: 202,
        }),
        25,
      ),
    { code: "forgejo_poll_response_invalid" },
  );
});

test("Forgejo failure owners are one positive consistent identity list", () => {
  assert.deepEqual(
    forgejoFailureRepositoryIds({ repositoryIds: [101, 202] }),
    [101, 202],
  );
  assert.deepEqual(
    forgejoFailureRepositoryIds({ repositoryId: 101, repositoryIds: [101] }),
    [101],
  );
  for (const failure of [
    { repositoryId: 101, repositoryIds: [202] },
    { repositoryId: 101, repositoryIds: [101, 202] },
    { repositoryId: 0 },
    { repositoryIds: [-1] },
  ]) {
    assert.throws(
      () => forgejoFailureRepositoryIds(failure),
      /Forgejo failure Repository owners are invalid/,
    );
  }
});

test("polling gates every selected Repository named by one failure", () => {
  const updates: { parameters: unknown[]; sql: string }[] = [];
  recordForgejoPollingOwningFailure(
    {
      run(sql: string, ...parameters: Array<unknown>) {
        updates.push({ parameters, sql });
        return { changes: 1 };
      },
    },
    "connection-1",
    [101, 202, 303],
    Object.assign(new Error("missing"), {
      code: "forgejo_repository_selection_unavailable",
      repositoryIds: [101, 202],
    }),
    25,
  );
  assert.equal(updates.length, 2);
  assert.deepEqual(
    updates.map(({ parameters }) => parameters.at(-1)),
    [101, 202],
  );
});

test("Forgejo rate, transient, partial-delivery, and ownerless Repository failures do not become health", () => {
  for (const failure of [
    { code: "forgejo_api_rate_limited", nextAttemptAt: 125_000 },
    { code: "forgejo_api_transient_failure", nextAttemptAt: 61_000 },
    { code: "forgejo_api_unavailable" },
    { code: "repository_git_verification_unavailable" },
    { code: "forgejo_repository_permission_denied" },
  ]) {
    assert.equal(forgejoDefinitiveFailureScope(failure), null, failure.code);
  }
});
