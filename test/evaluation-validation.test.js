import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalExplicitEvaluationRequest,
  EvaluationError,
  requireIdempotencyKey,
} from "../src/evaluation-validation.js";
import {
  createEvaluationService,
  createUnavailableEvaluationService,
} from "../src/evaluation.js";
import { readIdempotentReplay } from "../src/evaluation-idempotency.js";
import { canonicalOpenApiDocument } from "../src/canonical-api.js";

test("explicit Evaluation accepts exactly typed pushed branch and commit selectors", () => {
  assert.deepEqual(
    canonicalExplicitEvaluationRequest({
      base: { type: "branch", value: "main" },
      head: {
        type: "commit",
        value: "0123456789ABCDEF0123456789ABCDEF01234567",
      },
    }),
    {
      base: { type: "branch", value: "main" },
      head: {
        type: "commit",
        value: "0123456789abcdef0123456789abcdef01234567",
      },
    },
  );
  assert.deepEqual(
    canonicalExplicitEvaluationRequest({
      base: { type: "branch", value: "main" },
      head: { type: "commit", value: "A".repeat(64) },
    }).head,
    { type: "commit", value: "a".repeat(64) },
  );
  assert.deepEqual(
    canonicalExplicitEvaluationRequest({
      base: { type: "branch", value: "@/topic" },
      head: { type: "branch", value: "main" },
    }).base,
    { type: "branch", value: "@/topic" },
  );
});

test("Evaluation HTTP operations advertise their exact authorities", () => {
  const paths = canonicalOpenApiDocument().paths;
  assert.deepEqual(paths["/api/v1/evaluations"].get.security, [
    { browser_session: [] },
    { implementer_token: [] },
  ]);
  for (const operation of [
    paths["/api/v1/evaluations/{evaluation_id}"].get,
    paths["/api/v1/evaluations/{evaluation_id}/result"].get,
    paths["/api/v1/repositories/{repository_id}/evaluations"].post,
  ]) {
    assert.deepEqual(operation.security, [
      { browser_session: [] },
      { implementer_token: [] },
      { onboarding_token: [] },
    ]);
  }
  const branchPattern =
    canonicalOpenApiDocument().components.schemas.EvaluationSelector.oneOf[0]
      .properties.value.pattern;
  assert.equal(new RegExp(branchPattern).test("@/topic"), true);
  assert.equal(new RegExp(branchPattern).test("@"), false);
});

test("explicit Evaluation rejects every malformed request and selector shape", () => {
  for (const request of [null, [], {}, { base: {}, head: {} }]) {
    assert.throws(
      () => canonicalExplicitEvaluationRequest(request),
      (error) =>
        error instanceof EvaluationError &&
        ["evaluation_request_invalid", "evaluation_selector_invalid"].includes(
          error.code,
        ),
    );
  }
  for (const base of [
    null,
    [],
    { type: "branch" },
    { type: "branch", value: 1 },
    { type: "tag", value: "v1" },
    { type: "commit", value: "0123456" },
    ...[
      "",
      "@",
      ".hidden",
      "/main",
      "main.",
      "main/",
      "main.lock",
      "release..main",
      "release//main",
      "release@{main",
      "release main",
      "release~main",
      "release/.hidden",
      "release/topic.lock/more",
    ].map((value) => ({ type: "branch", value })),
  ]) {
    const request = {
      base,
      head: { type: "branch", value: "main" },
    };
    assert.throws(
      () => canonicalExplicitEvaluationRequest(request),
      (error) =>
        error instanceof EvaluationError &&
        error.code === "evaluation_selector_invalid",
    );
  }
  for (const request of [
    {
      base: { type: "branch", value: "main", fallback: "HEAD" },
      head: { type: "branch", value: "topic" },
    },
  ]) {
    assert.throws(
      () => canonicalExplicitEvaluationRequest(request),
      (error) =>
        error instanceof EvaluationError &&
        error.code === "evaluation_selector_invalid",
    );
  }
});

test("Evaluation idempotency requires one bounded visible ASCII key", () => {
  assert.equal(requireIdempotencyKey("request-1"), "request-1");
  for (const value of [undefined, "", "x".repeat(256), "request key"]) {
    assert.throws(
      () => requireIdempotencyKey(value),
      (error) =>
        error instanceof EvaluationError &&
        error.code === "idempotency_key_required",
    );
  }
});

test("explicit Evaluation idempotency replays only an already accepted key", () => {
  const route = "/api/v1/repositories/repository-1/evaluations";
  const access = {
    /**
     * @param {string} sql
     * @param {import("node:sqlite").SQLInputValue} channel
     * @param {import("node:sqlite").SQLInputValue} requestedRoute
     * @param {import("node:sqlite").SQLInputValue} key
     */
    get(sql, channel, requestedRoute, key) {
      assert.match(sql, /FROM evaluation_idempotency/);
      assert.equal(channel, "implementer_token");
      assert.equal(requestedRoute, route);
      return key === "accepted-key"
        ? {
            request_hash: "same-request",
            response_body: JSON.stringify({ id: "evaluation-1" }),
            response_status: 201,
          }
        : undefined;
    },
  };
  assert.deepEqual(
    readIdempotentReplay(
      access,
      "implementer_token",
      route,
      "accepted-key",
      "same-request",
    ),
    { resource: { id: "evaluation-1" }, status: 201 },
  );
  assert.equal(
    readIdempotentReplay(
      access,
      "implementer_token",
      route,
      "intentional-rerun-key",
      "same-request",
    ),
    null,
  );
  assert.throws(
    () =>
      readIdempotentReplay(
        access,
        "implementer_token",
        route,
        "accepted-key",
        "different-request",
      ),
    (error) =>
      error instanceof EvaluationError && error.code === "idempotency_conflict",
  );
});

test("Evaluation construction and creation identities fail before durable work", async () => {
  const core = {
    all() {
      return [];
    },
    get() {
      return undefined;
    },
    transaction() {
      throw new Error("transaction must not begin");
    },
  };
  const options = {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    masterKey: Buffer.alloc(32, 7),
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  };
  for (const [durableCore, candidateOptions] of [
    [null, options],
    [core, { ...options, acquireChangeset: undefined }],
    [core, { ...options, readCodexCapabilityFailure: undefined }],
    [core, { ...options, createId: 1 }],
    [core, { ...options, now: 1 }],
    [core, { ...options, storageReserve: {} }],
  ]) {
    assert.throws(
      () =>
        createEvaluationService(
          /** @type {any} */ (durableCore),
          /** @type {any} */ (candidateOptions),
        ),
      /Evaluation dependencies are invalid/,
    );
  }
  const service = createEvaluationService(/** @type {any} */ (core), options);
  const validInput = {
    channel: /** @type {"browser_session"} */ ("browser_session"),
    idempotencyKey: "request-1",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  };
  for (const input of [
    {
      channel: "unknown",
      idempotencyKey: "request-1",
      repositoryId: "repository-1",
      request: {
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      },
    },
    {
      channel: "browser_session",
      idempotencyKey: "request-1",
      repositoryId: "",
      request: {
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      },
    },
  ]) {
    await assert.rejects(
      () => service.createExplicit(/** @type {any} */ (input)),
      /Evaluation creation identity is invalid/,
    );
  }
  for (const invalidOptions of [
    {
      ...options,
      acquireChangeset: async () => ({
        base_commit: "abbreviated",
        head_commit: "2".repeat(40),
      }),
    },
    {
      ...options,
      acquireChangeset: async () => ({
        base_commit: "1".repeat(40),
        head_commit: "abbreviated",
      }),
    },
    {
      ...options,
      acquireChangeset: async () => ({
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(64),
      }),
    },
  ]) {
    await assert.rejects(
      () =>
        createEvaluationService(
          /** @type {any} */ (core),
          invalidOptions,
        ).createExplicit(validInput),
      /Acquired Evaluation commits are invalid/,
    );
  }
  for (const invalidOptions of [
    { ...options, createId: () => "" },
    { ...options, now: () => 1.5 },
  ]) {
    await assert.rejects(
      () =>
        createEvaluationService(
          /** @type {any} */ (core),
          invalidOptions,
        ).createExplicit(validInput),
      /Evaluation identity or timestamp is invalid/,
    );
  }
});

test("an unavailable Evaluation service preserves a coded cause or owns one exact default", async () => {
  for (const [cause, code] of [
    [
      Object.assign(new Error("Storage is unavailable"), {
        code: "storage_unavailable",
      }),
      "storage_unavailable",
    ],
    [new TypeError("unexpected"), "evaluation_capability_unavailable"],
  ]) {
    const service = createUnavailableEvaluationService(cause);
    for (const operation of [
      () => service.createExplicit(),
      () => service.list(),
      () => service.read(),
      () => service.readResult(),
    ]) {
      await assert.rejects(
        async () => operation(),
        (error) => error instanceof EvaluationError && error.code === code,
      );
    }
  }
});

test("Evaluation reads distinguish missing work from a not-ready Result", () => {
  const options = {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    masterKey: Buffer.alloc(32, 7),
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  };
  const core = {
    all() {
      return [];
    },
    get() {
      return undefined;
    },
    transaction() {
      throw new Error("transaction must not begin");
    },
  };
  const missing = createEvaluationService(/** @type {any} */ (core), options);
  for (const operation of [
    () => missing.read("missing"),
    () => missing.readResult("missing"),
  ]) {
    assert.throws(
      operation,
      (error) =>
        error instanceof EvaluationError &&
        error.code === "evaluation_not_found",
    );
  }
  const pending = createEvaluationService(
    /** @type {any} */ ({
      ...core,
      /** @param {string} sql */
      get(sql) {
        return sql.startsWith("SELECT id FROM evaluations")
          ? { id: "pending" }
          : undefined;
      },
    }),
    options,
  );
  assert.throws(
    () => pending.readResult("pending"),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "evaluation_result_not_ready",
  );
});
