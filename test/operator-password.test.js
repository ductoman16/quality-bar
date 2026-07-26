import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  OperatorPasswordError,
  bootstrapOperatorPassword,
} from "../src/operator-password.js";

const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-password-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("bootstraps one minimum-length password as a salted memory-hard verifier", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "correct horse battery staple";

  bootstrapOperatorPassword(core, password, {
    randomBytes: () => Buffer.alloc(16, 9),
  });

  const verifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  ).value;
  assert.match(
    verifier,
    /^scrypt-v1\.32768\.8\.1\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/,
  );
  assert.doesNotMatch(verifier, new RegExp(password));
  assert.doesNotMatch(verifier, /correct|horse|battery|staple/);

  core.close();
});

test("host bootstrap clears any durable failed-login delay", () => {
  const core = openDurableCore(temporaryDatabasePath());
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "failed_operator_login_attempts",
    "7",
  );
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "failed_operator_login_until",
    "60000",
  );

  bootstrapOperatorPassword(core, "a correct operator password");

  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "failed_operator_login_attempts",
    ),
    undefined,
  );
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "failed_operator_login_until",
    ),
    undefined,
  );
  core.close();
});

test("rejects a password shorter than fifteen characters without storing state", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "fourteen chars";

  assert.throws(
    () => bootstrapOperatorPassword(core, password),
    (error) => {
      assert.ok(error instanceof OperatorPasswordError);
      assert.equal(error.code, "operator_password_too_short");
      assert.equal(
        error.message,
        "Operator password must be at least 15 characters",
      );
      assert.doesNotMatch(error.message, new RegExp(password));
      return true;
    },
  );
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    ),
    undefined,
  );

  core.close();
});

test("allows bootstrap only once and leaves the first verifier unchanged", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const firstPassword = "a secure initial password";
  const secondPassword = "a secure replacement password";

  bootstrapOperatorPassword(core, firstPassword, {
    randomBytes: () => Buffer.alloc(16, 1),
  });
  const originalVerifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  ).value;

  assert.throws(
    () => bootstrapOperatorPassword(core, secondPassword),
    (error) => {
      assert.ok(error instanceof OperatorPasswordError);
      assert.equal(error.code, "operator_password_already_set");
      assert.equal(error.message, "Operator password is already set");
      return true;
    },
  );
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    ).value,
    originalVerifier,
  );

  core.close();
});

test("does not store state when verifier creation fails", () => {
  const core = openDurableCore(temporaryDatabasePath());

  assert.throws(
    () =>
      bootstrapOperatorPassword(core, "a password that is long enough", {
        randomBytes() {
          throw new Error("randomness unavailable");
        },
      }),
    (error) => {
      assert.ok(error instanceof OperatorPasswordError);
      assert.equal(error.code, "operator_password_verifier_unavailable");
      assert.equal(
        error.message,
        "Operator password verifier could not be created",
      );
      return true;
    },
  );
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    ),
    undefined,
  );

  core.close();
});
