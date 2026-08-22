import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeRepositoryCredentialRotation,
  RepositoryError,
  normalizeRepositoryRegistration,
  normalizePublicRepositoryUrl,
} from "../src/repository/repository-validation.js";

test("a public Generic Repository identity is its normalized HTTPS URL", () => {
  assert.equal(
    normalizePublicRepositoryUrl({
      url: "https://EXAMPLE.com:443/%7eteam/%41pp%2frepository.git/",
    }),
    "https://example.com/~team/App%2Frepository.git",
  );
});

test("public Generic Repository registration rejects unsupported inputs exactly", () => {
  for (const [request, code] of [
    [{}, "repository_url_required"],
    [{ url: "not a URL" }, "repository_url_invalid"],
    [
      { url: "http://example.com/repository.git" },
      "repository_transport_unsupported",
    ],
    [
      { url: "ssh://git@example.com/repository.git" },
      "repository_transport_unsupported",
    ],
    [
      { url: "https://operator:token@example.com/repository.git" },
      "repository_credentials_unsupported",
    ],
    [
      { url: "https://example.com/repository.git?ref=main" },
      "repository_url_invalid",
    ],
    [
      { url: "https://example.com/repository.git#main" },
      "repository_url_invalid",
    ],
  ]) {
    assert.throws(
      () => normalizePublicRepositoryUrl(request),
      (error) => error instanceof RepositoryError && error.code === code,
    );
  }
});

test("a credentialed Generic Repository accepts one complete write-only username and token", () => {
  assert.deepEqual(
    normalizeRepositoryRegistration({
      token: "private-token-value",
      url: "https://EXAMPLE.com:443/%7Eteam/private.git/",
      username: "operator",
    }),
    {
      credential: {
        token: "private-token-value",
        username: "operator",
      },
      url: "https://example.com/~team/private.git",
    },
  );
});

test("credentialed Repository registration rejects incomplete credentials without exposing submitted values", () => {
  for (const [request, code] of [
    [
      {
        token: "private-token-value",
        url: "https://example.com/private.git",
      },
      "repository_username_required",
    ],
    [
      {
        url: "https://example.com/private.git",
        username: "operator",
      },
      "repository_token_required",
    ],
    [
      {
        token: "",
        url: "https://example.com/private.git",
        username: "operator",
      },
      "repository_token_required",
    ],
  ]) {
    assert.throws(
      () => normalizeRepositoryRegistration(request),
      (error) => {
        assert.ok(error instanceof RepositoryError);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /private-token-value|operator/);
        return true;
      },
    );
  }
});

test("credentialed Repository registration rejects URL userinfo with its exact transport-neutral error", () => {
  assert.throws(
    () =>
      normalizeRepositoryRegistration({
        token: "private-token-value",
        url: "https://embedded:credential@example.com/private.git",
        username: "operator",
      }),
    (error) => {
      assert.ok(error instanceof RepositoryError);
      assert.equal(error.code, "repository_credentials_unsupported");
      assert.equal(
        error.message,
        "Repository URL must not contain credentials",
      );
      assert.doesNotMatch(
        error.message,
        /embedded|private-token-value|operator/,
      );
      return true;
    },
  );
});

test("a Generic Repository credential rotation accepts exactly one replacement username and token", () => {
  assert.deepEqual(
    normalizeRepositoryCredentialRotation({
      token: "replacement-private-token",
      username: "replacement-operator",
    }),
    {
      token: "replacement-private-token",
      username: "replacement-operator",
    },
  );

  for (const [request, code] of [
    [{ token: "replacement-private-token" }, "repository_username_required"],
    [{ username: "replacement-operator" }, "repository_token_required"],
    [
      {
        token: "replacement-private-token",
        unexpected: true,
        username: "replacement-operator",
      },
      "repository_request_invalid",
    ],
  ]) {
    assert.throws(
      () => normalizeRepositoryCredentialRotation(request),
      (error) => {
        assert.ok(error instanceof RepositoryError);
        assert.equal(error.code, code);
        assert.doesNotMatch(
          error.message,
          /replacement-private-token|replacement-operator/,
        );
        return true;
      },
    );
  }
});
