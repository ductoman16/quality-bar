import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RepositoryError,
  normalizePublicRepositoryUrl,
} from "../src/repository-validation.js";

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
