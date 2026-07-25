import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  bootstrapOperatorPasswordFromHost,
  passwordFromStandardInput,
  readOperatorPassword,
} from "../src/operator-password-bootstrap.js";
import { OPERATOR_PASSWORD_VERIFIER_METADATA_KEY } from "../src/operator-password.js";

const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-bootstrap-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function validInstallation() {
  return { masterKey: Buffer.alloc(32, 7) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("accepts a password only from standard input and preserves intentional spaces", async () => {
  assert.equal(passwordFromStandardInput("  secure passphrase  \n"), "  secure passphrase  ");
  await assert.rejects(
    readOperatorPassword({
      input: { fd: 9, isTTY: false },
      readFile() {
        throw new Error("not readable");
      },
    }),
    (error) => {
      assert.equal(error.code, "operator_password_input_missing");
      assert.equal(error.message, "Operator password input is required");
      return true;
    },
  );
});

test("host bootstrap verifies the owned installation before reading stdin and stores no plaintext", async () => {
  const databasePath = temporaryDatabasePath();
  let passwordWasRead = false;
  let lockReleased = false;
  const password = "a password supplied through standard input";

  await bootstrapOperatorPasswordFromHost({
    databasePath,
    loadInstallation: validInstallation,
    readPassword() {
      passwordWasRead = true;
      return password;
    },
    validateInstallation() {
      return {
        releaseInstallationLock() {
          lockReleased = true;
        },
      };
    },
    validateSources() {},
  });

  assert.equal(passwordWasRead, true);
  assert.equal(lockReleased, true);
  const core = openDurableCore(databasePath);
  const verifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  ).value;
  assert.match(verifier, /^scrypt-v1\./);
  assert.doesNotMatch(verifier, new RegExp(password));
  core.close();
});

test("host bootstrap does not read a password when configuration validation fails", async () => {
  let passwordWasRead = false;
  const failure = new Error("unsafe source");
  failure.code = "owned_path_unsafe";

  await assert.rejects(
    bootstrapOperatorPasswordFromHost({
      databasePath: temporaryDatabasePath(),
      readPassword() {
        passwordWasRead = true;
        return "a password that must not be read";
      },
      validateSources() {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(passwordWasRead, false);
});

test("the host command has no environment or argument password channel", () => {
  const command = readFileSync(
    new URL("../src/bootstrap-operator-password.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(command, /process\.argv|process\.env/);
  assert.match(command, /bootstrapOperatorPasswordFromHost/);
});
