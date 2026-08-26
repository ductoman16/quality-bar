import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryService } from "../src/repository/repository.ts";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.ts";
import { assertRepositoryConflict } from "./repository-lifecycle-http-integration-support.ts";

test("the canonical Repository resource deletes only never-used identity and re-registers retired identity", async () => {
  let durableCore: any;
  const repositoryIds = ["repository-never-used", "repository-used"];
  const { request } = await startApplication({
    createRepositories(core, options) {
      durableCore = core;
      return createRepositoryService(core, {
        ...options,
        createId: () => repositoryIds.shift() ?? "unexpected-repository-id",
        async verifyRead() {},
      });
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/never-used.git" }),
    headers,
    method: "POST",
  });
  const unsupportedRetirement = await request(
    "/api/v1/repositories/repository-never-used/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "retired" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(unsupportedRetirement.status, 409);
  assert.equal(
    await responseErrorCode(unsupportedRetirement),
    "repository_retirement_unsupported",
  );
  for (const malformedBody of ["null", "[]", '"invalid"']) {
    const malformedDeletion = await request.invalidRequest(
      "/api/v1/repositories/repository-never-used",
      {
        body: malformedBody,
        headers,
        method: "DELETE",
      },
    );
    assert.equal(malformedDeletion.status, 400);
    assert.equal(
      await responseErrorCode(malformedDeletion),
      "request_malformed",
    );
  }
  const deleted = await request("/api/v1/repositories/repository-never-used", {
    body: "{}",
    headers,
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(await deleted.json(), null);

  await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/used.git" }),
    headers,
    method: "POST",
  });
  durableCore.run(
    "UPDATE repositories SET has_been_used = 1 WHERE id = ?",
    "repository-used",
  );
  const retired = await request(
    "/api/v1/repositories/repository-used/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "retired" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(retired.status, 200);
  assert.equal(
    ((await retired.json()) as { lifecycle: string }).lifecycle,
    "retired",
  );
  const unsupportedDeletion = await request(
    "/api/v1/repositories/repository-used",
    {
      body: "{}",
      headers,
      method: "DELETE",
    },
  );
  assert.equal(unsupportedDeletion.status, 409);
  assert.equal(
    await responseErrorCode(unsupportedDeletion),
    "repository_delete_unsupported",
  );
  const reactivated = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/used.git" }),
    headers,
    method: "POST",
  });
  assert.equal(reactivated.status, 200);
  assert.deepEqual(await reactivated.json(), {
    credential_type: "none",
    deletion_eligible: false,
    health: "healthy",
    health_error: null,
    id: "repository-used",
    lifecycle: "enabled",
    url: "https://example.com/used.git",
  });
});

test("Repository deletion conflicts return exact present and absent current state", async () => {
  let attempt = 0;
  const { request } = await startApplication({
    createRepositories(core, options) {
      const repositories = createRepositoryService(core, {
        ...options,
        createId: () => "repository-delete-conflict",
        async verifyRead() {},
      });
      return {
        ...repositories,
        remove(repositoryId: string) {
          attempt += 1;
          if (attempt === 1) {
            throw Object.assign(
              new Error("Repository changed during deletion"),
              { code: "repository_lifecycle_conflict" },
            );
          }
          repositories.remove(repositoryId);
          throw Object.assign(new Error("Repository changed during deletion"), {
            code: "repository_lifecycle_conflict",
          });
        },
      };
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const registered = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/delete-conflict.git" }),
    headers,
    method: "POST",
  });
  const current = await registered.json();

  for (const expectedCurrent of [current, null]) {
    const conflict = await request(
      "/api/v1/repositories/repository-delete-conflict",
      {
        body: "{}",
        headers,
        method: "DELETE",
      },
    );
    await assertRepositoryConflict(conflict, {
      code: "repository_lifecycle_conflict",
      current: expectedCurrent,
      message: "Repository changed during deletion",
    });
  }
});
