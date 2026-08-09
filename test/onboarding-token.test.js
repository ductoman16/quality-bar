import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createOnboardingTokenService } from "../src/onboarding-token.js";

test("onboarding tokens are hashed, URL-bound, concurrent, and expire after 24 hours", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-onboarding-token-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  let time = 1_000;
  let byte = 0;
  /** @type {string[]} */
  const registeredSecrets = [];
  const tokens = createOnboardingTokenService(core, {
    createId: () => `token-${++byte}`,
    now: () => time,
    randomBytes: () => Buffer.alloc(32, byte),
    registerSecret: (secret) => registeredSecrets.push(secret),
  });

  const first = tokens.create({
    repository_url: "https://example.com/one.git",
  });
  const second = tokens.create({
    repository_url: "https://example.com/two.git",
  });

  assert.equal(
    tokens.authenticate(first.token)?.repository_url,
    "https://example.com/one.git",
  );
  assert.equal(
    tokens.authenticate(second.token)?.repository_url,
    "https://example.com/two.git",
  );
  assert.deepEqual(registeredSecrets, [first.token, second.token]);
  assert.equal(
    core.get("SELECT verifier FROM onboarding_tokens WHERE id = ?", first.id)
      ?.verifier === first.token,
    false,
  );
  assert.throws(
    () => tokens.create({ repository_url: "https://example.com/one.git" }),
    /** @param {unknown} error */ (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "onboarding_token_already_active",
  );

  tokens.selfRevoke(first.token);
  assert.equal(tokens.authenticate(first.token), null);
  assert.equal(tokens.list().length, 1);

  time += 24 * 60 * 60 * 1_000;
  assert.equal(tokens.authenticate(second.token), null);
  assert.deepEqual(tokens.list(), []);
});
