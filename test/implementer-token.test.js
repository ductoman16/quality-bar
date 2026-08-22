import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createImplementerTokenService } from "../src/implementer-token.js";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.js";

/** @type {string[]} */
const temporaryDirectories = [];

/** @param {unknown} error */
function implementerTokenError(error) {
  assert.ok(error instanceof Error && "code" in error);
  return /** @type {Error & {code: string}} */ (error);
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-implementer-token-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("creates, rotates, and revokes one verifier-only implementer token", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  let byte = 0;
  bootstrapOperatorPassword(core, password);
  const tokens = createImplementerTokenService(core, {
    randomBytes: () => Buffer.alloc(32, ++byte),
  });

  const created = tokens.create(password);

  assert.match(created, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokens.authenticate(created), true);
  const verifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    "implementer_token_verifier",
  )?.value;
  if (typeof verifier !== "string") {
    throw new Error("implementer_token_verifier_missing");
  }
  assert.match(verifier, /^sha256-v1\.[A-Za-z0-9+/]{43}=$/);
  assert.doesNotMatch(verifier, new RegExp(created));
  assert.throws(
    () => tokens.create(password),
    (error) =>
      implementerTokenError(error).code === "implementer_token_already_active",
  );

  const rotated = tokens.rotate(password);

  assert.match(rotated, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated, created);
  assert.equal(tokens.authenticate(created), false);
  assert.equal(tokens.authenticate(rotated), true);

  tokens.revoke(password);

  assert.equal(tokens.authenticate(rotated), false);
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "implementer_token_verifier",
    ),
    undefined,
  );
  assert.throws(
    () => tokens.revoke(password),
    (error) =>
      implementerTokenError(error).code === "implementer_token_not_active",
  );
  core.close();
});

test("rejects a stale password without creating or changing the implementer token", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(core, password);
  const tokens = createImplementerTokenService(core);

  assert.throws(
    () => tokens.create("an incorrect operator password"),
    (error) => implementerTokenError(error).code === "authentication_invalid",
  );
  assert.equal(tokens.hasActiveToken(), false);
  const created = tokens.create(password);
  assert.throws(
    () => tokens.rotate("an incorrect operator password"),
    (error) => implementerTokenError(error).code === "authentication_invalid",
  );
  assert.equal(tokens.authenticate(created), true);
  core.close();
});

test("a malformed implementer-token verifier is an exact hard authentication failure", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(core, password);
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "implementer_token_verifier",
    "not-a-token-verifier",
  );
  const tokens = createImplementerTokenService(core);

  assert.throws(
    () => tokens.authenticate("A".repeat(43)),
    (error) =>
      implementerTokenError(error).code ===
      "implementer_token_verifier_unavailable",
  );
  assert.throws(
    () => tokens.hasActiveToken(),
    (error) =>
      implementerTokenError(error).code ===
      "implementer_token_verifier_unavailable",
  );
  core.close();
});
