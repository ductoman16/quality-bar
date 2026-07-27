import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRepositoryAcceptsNewWork,
  normalizeRepositoryLifecycleChange,
  RepositoryError,
} from "../src/repository-validation.js";

test("Repository lifecycle changes accept only the operator-owned enabled and disabled transitions", () => {
  assert.deepEqual(
    normalizeRepositoryLifecycleChange({ lifecycle: "enabled" }),
    {
      lifecycle: "enabled",
    },
  );
  assert.deepEqual(
    normalizeRepositoryLifecycleChange({ lifecycle: "disabled" }),
    { lifecycle: "disabled" },
  );

  for (const [request, code] of [
    [{}, "repository_lifecycle_required"],
    [{ lifecycle: "retired" }, "repository_retirement_unsupported"],
    [
      { lifecycle: "disabled", unexpected: true },
      "repository_lifecycle_request_invalid",
    ],
  ]) {
    assert.throws(
      () => normalizeRepositoryLifecycleChange(request),
      (error) => error instanceof RepositoryError && error.code === code,
    );
  }
});

test("new work distinguishes operator lifecycle from the exact observed-health failure", () => {
  assert.doesNotThrow(() =>
    assertRepositoryAcceptsNewWork({
      health: "healthy",
      healthError: null,
      lifecycle: "enabled",
    }),
  );

  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "healthy",
        healthError: null,
        lifecycle: "disabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_disabled" &&
      error.message === "Repository is disabled",
  );
  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "healthy",
        healthError: null,
        lifecycle: "retired",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_retired" &&
      error.message === "Repository is retired",
  );
  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "error",
        healthError: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed" &&
      error.message === "Repository Git read verification failed",
  );
});
