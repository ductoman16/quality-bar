import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { recoverOperatorAuthorityFromHost } from "../src/operator-authority-recovery.js";
import {
  bootstrapOperatorPassword,
  verifyOperatorPassword,
} from "../src/operator-password.js";

/** @type {string[]} */
const temporaryDirectories = [];

function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-authority-recovery-host-"),
  );
  temporaryDirectories.push(directory);
  return {
    backupsPath: join(directory, "backups"),
    databasePath: join(directory, "quality-bar.sqlite3"),
  };
}

/** @param {unknown} value */
function throwValue(value) {
  throw value;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("host recovery validates the stopped installation and replaces authority from stdin", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  bootstrapOperatorPassword(core, "the original operator password");
  core.close();
  const masterKey = Buffer.alloc(32, 7);
  const freeSpaceReserveBytes = 7 * 1024 ** 3;
  let passwordWasRead = false;
  let lockReleased = false;
  let receivedReserveBytes;

  await recoverOperatorAuthorityFromHost({
    applicationVersion: "0.1.0",
    backupsPath: input.backupsPath,
    databasePath: input.databasePath,
    loadInstallation: () => ({ freeSpaceReserveBytes, masterKey }),
    readPassword() {
      passwordWasRead = true;
      return "the replacement operator password";
    },
    validateInstallation({ reserveBytes }) {
      receivedReserveBytes = reserveBytes;
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
  assert.equal(receivedReserveBytes, freeSpaceReserveBytes);
  assert.deepEqual(masterKey, Buffer.alloc(32));
  const recovered = openDurableCore(input.databasePath);
  verifyOperatorPassword(recovered, "the replacement operator password");
  recovered.close();
});

test("cleanup failure cannot replace the owning recovery diagnostic", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  bootstrapOperatorPassword(core, "the original operator password");
  core.close();
  const masterKey = Buffer.alloc(32, 7);
  const owningFailure = new Error("password source failed");
  const releaseFailure = new Error("lock release failed");

  await assert.rejects(
    recoverOperatorAuthorityFromHost({
      applicationVersion: "0.1.0",
      backupsPath: input.backupsPath,
      databasePath: input.databasePath,
      loadInstallation: () => ({
        freeSpaceReserveBytes: 5 * 1024 ** 3,
        masterKey,
      }),
      readPassword() {
        throw owningFailure;
      },
      validateInstallation: () => ({
        releaseInstallationLock() {
          throw releaseFailure;
        },
      }),
      validateSources() {},
    }),
    (error) =>
      error instanceof Error &&
      error === owningFailure &&
      error.cause instanceof AggregateError &&
      error.cause.errors.includes(releaseFailure),
  );

  assert.deepEqual(masterKey, Buffer.alloc(32));
});

test("a post-commit cleanup failure reports that recovery committed and preserves the exact failure", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  bootstrapOperatorPassword(core, "the original operator password");
  core.close();
  const masterKey = Buffer.alloc(32, 7);
  const releaseFailure = new Error("lock release failed");
  let authorityRecovered = false;

  await assert.rejects(
    recoverOperatorAuthorityFromHost({
      applicationVersion: "0.1.0",
      backupsPath: input.backupsPath,
      databasePath: input.databasePath,
      loadInstallation: () => ({
        freeSpaceReserveBytes: 5 * 1024 ** 3,
        masterKey,
      }),
      onAuthorityRecovered() {
        authorityRecovered = true;
      },
      readPassword: () => "the replacement operator password",
      validateInstallation: () => ({
        releaseInstallationLock() {
          throw releaseFailure;
        },
      }),
      validateSources() {},
    }),
    (error) => error === releaseFailure,
  );

  assert.equal(authorityRecovered, true);
  assert.deepEqual(masterKey, Buffer.alloc(32));
  const recovered = openDurableCore(input.databasePath);
  verifyOperatorPassword(recovered, "the replacement operator password");
  recovered.close();
});

test("non-Error failures remain exact and cannot become inferred success", async () => {
  for (const failure of [undefined, "non-error cleanup failure"]) {
    const input = fixture();
    const core = openDurableCore(input.databasePath);
    bootstrapOperatorPassword(core, "the original operator password");
    core.close();
    let rejected = false;
    try {
      await recoverOperatorAuthorityFromHost({
        applicationVersion: "0.1.0",
        backupsPath: input.backupsPath,
        databasePath: input.databasePath,
        loadInstallation: () => ({
          freeSpaceReserveBytes: 5 * 1024 ** 3,
          masterKey: Buffer.alloc(32, 7),
        }),
        readPassword:
          failure === undefined
            ? () => Promise.reject(failure)
            : () => "the replacement operator password",
        validateInstallation: () => ({
          releaseInstallationLock() {
            if (failure !== undefined) {
              throwValue(failure);
            }
          },
        }),
        validateSources() {},
      });
    } catch (error) {
      rejected = true;
      assert.equal(error, failure);
    }
    assert.equal(rejected, true);
  }
});

test("host recovery does not read a password when installation validation fails", async () => {
  let passwordWasRead = false;
  const failure = Object.assign(new Error("unsafe source"), {
    code: "owned_path_unsafe",
  });

  await assert.rejects(
    recoverOperatorAuthorityFromHost({
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

test("the recovery command has no argument or environment password channel", () => {
  const command = readFileSync(
    new URL("../src/recover-operator-authority.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(command, /process\.argv|PASSWORD/);
  assert.match(command, /recoverOperatorAuthorityFromHost/);
  assert.match(command, /onAuthorityRecovered/);
  assert.match(command, /"cleanup":"failed"/);
  assert.match(command, /"status":"operator_authority_recovered"/);
  assert.match(command, /throw error/);
});
