import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { APPLICABILITY_SEAL_SCHEMA } from "../src/applicability-seal-schema.js";
import { verifyInstallationKey } from "../src/installation-configuration.js";
import { owningRestoreError } from "../src/offline-restore-error.js";
import { restoreOfflineBackup } from "../src/offline-restore.js";
import { copyRestoreCandidate } from "../src/offline-restore-snapshot.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

function emptyDatabasePath() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-candidate-copy-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

async function restoreFixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-candidate-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const backupsPath = join(directory, "backups");
  const masterKey = Buffer.alloc(32, 7);
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.close();
  const database = new DatabaseSync(databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath,
    database,
    keyIdentity: installationKeyIdentity(masterKey),
    kind: "daily",
  });
  database.close();
  return {
    backup,
    databasePath,
    masterKey,
    original: readFileSync(databasePath),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a partial candidate copy is removed with its owning diagnostic", () => {
  const databasePath = emptyDatabasePath();
  const candidateDirectory = join(databasePath, "..", ".candidate");

  assert.throws(
    () =>
      copyRestoreCandidate(databasePath, "/snapshot.sqlite3", {
        copy(source, destination) {
          assert.equal(source, "/snapshot.sqlite3");
          writeFileSync(destination, "partial");
          throw new Error("copy failed");
        },
        makeDirectory() {
          mkdirSync(candidateDirectory);
          return candidateDirectory;
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_create_failed",
  );
  assert.equal(existsSync(candidateDirectory), false);
});

test("candidate creation preserves cleanup failure detail", () => {
  const databasePath = emptyDatabasePath();
  const candidateDirectory = join(databasePath, "..", ".candidate");

  assert.throws(
    () =>
      copyRestoreCandidate(databasePath, "/snapshot.sqlite3", {
        copy() {
          throw new Error("copy failed");
        },
        makeDirectory() {
          mkdirSync(candidateDirectory);
          return candidateDirectory;
        },
        remove() {
          throw new Error("cleanup failed");
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_create_failed" &&
      error.cause instanceof AggregateError,
  );
});

test("candidate directory failure and uncoded filesystem errors get restore ownership", () => {
  const databasePath = emptyDatabasePath();
  assert.throws(
    () =>
      copyRestoreCandidate(databasePath, "/snapshot.sqlite3", {
        makeDirectory() {
          throw new Error("directory failed");
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_create_failed",
  );

  const failure = owningRestoreError(
    new Error("uncoded"),
    "restore_input_failed",
    "Restore input failed",
  );
  assert.equal(failure.name, "OfflineRestoreError");
  assert.equal(failure.code, "restore_input_failed");
});

test("the copied candidate is revalidated before migration-capable access", async () => {
  const input = await restoreFixture();
  const substitutePath = join(
    input.backup.databasePath,
    "..",
    "substitute.sqlite3",
  );
  copyFileSync(input.backup.databasePath, substitutePath);
  const substitute = new DatabaseSync(substitutePath);
  substitute.exec("PRAGMA user_version = 20");
  substitute.close();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      copyOperations: {
        copy(source, destination) {
          assert.equal(source, input.backup.databasePath);
          copyFileSync(substitutePath, destination);
        },
      },
      databasePath: input.databasePath,
      manifestPath: input.backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_schema_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), input.original);
});

test("a current-version snapshot missing required schema cannot replace the target", async () => {
  const input = await restoreFixture();
  const incomplete = new DatabaseSync(input.backup.databasePath);
  incomplete.exec("DROP TABLE reviews");
  incomplete.close();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: input.databasePath,
      manifestPath: input.backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_schema_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), input.original);
});

test(
  "an incompatible CHECK-like column fails instead of hanging candidate validation",
  { timeout: 2_000 },
  async () => {
    const input = await restoreFixture();
    const incompatible = new DatabaseSync(input.backup.databasePath);
    incompatible.exec("ALTER TABLE reviews ADD COLUMN check_marker TEXT");
    incompatible.close();

    await assert.rejects(
      restoreOfflineBackup({
        applicationVersion: "0.1.0",
        databasePath: input.databasePath,
        manifestPath: input.backup.manifestPath,
        masterKey: input.masterKey,
        operatorPassword: "a replacement operator password",
      }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "restore_candidate_schema_invalid",
    );

    assert.deepEqual(readFileSync(input.databasePath), input.original);
  },
);

test("a current-version snapshot with changed deferred foreign-key semantics cannot replace the target", async () => {
  const input = await restoreFixture();
  const snapshot = readFileSync(input.backup.databasePath);
  const deferredClause = Buffer.from(" DEFERRABLE INITIALLY DEFERRED");
  let clauseAt = snapshot.indexOf(deferredClause);
  assert.notEqual(clauseAt, -1);
  while (clauseAt >= 0) {
    snapshot.fill(" ", clauseAt, clauseAt + deferredClause.length);
    clauseAt = snapshot.indexOf(
      deferredClause,
      clauseAt + deferredClause.length,
    );
  }
  writeFileSync(input.backup.databasePath, snapshot);
  const incompatible = new DatabaseSync(input.backup.databasePath);
  assert.doesNotMatch(
    String(
      incompatible
        .prepare("SELECT sql FROM sqlite_schema WHERE name = 'reviews'")
        .get()?.sql,
    ),
    /DEFERRABLE INITIALLY DEFERRED/,
  );
  incompatible.close();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: input.databasePath,
      manifestPath: input.backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_schema_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), input.original);
});

test("a snapshot with a foreign-key violation cannot replace the target", async () => {
  const input = await restoreFixture();
  const invalid = new DatabaseSync(input.backup.databasePath);
  invalid.exec("PRAGMA foreign_keys = OFF");
  invalid
    .prepare(
      `INSERT INTO review_versions (
         id, review_id, number, model, reasoning_effort, service_tier,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "orphaned-version",
      "missing-review",
      1,
      "gpt-5",
      "high",
      "priority",
      1,
    );
  invalid.close();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: input.databasePath,
      manifestPath: input.backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_snapshot_integrity_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), input.original);
});

test("a copied candidate with a foreign-key violation cannot replace the target", async () => {
  const input = await restoreFixture();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      copyOperations: {
        copy(source, destination) {
          assert.equal(source, input.backup.databasePath);
          copyFileSync(source, destination);
          const invalid = new DatabaseSync(destination);
          invalid.exec("PRAGMA foreign_keys = OFF");
          invalid
            .prepare(
              `INSERT INTO review_versions (
                 id, review_id, number, model, reasoning_effort, service_tier,
                 created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              "orphaned-version",
              "missing-review",
              1,
              "gpt-5",
              "high",
              "priority",
              1,
            );
          invalid.close();
        },
      },
      databasePath: input.databasePath,
      manifestPath: input.backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_candidate_schema_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), input.original);
});

test("a validated snapshot replaces an unreadable stopped target", async () => {
  const input = await restoreFixture();
  writeFileSync(input.databasePath, "not a SQLite database");

  await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath: input.databasePath,
    manifestPath: input.backup.manifestPath,
    masterKey: input.masterKey,
    operatorPassword: "a replacement operator password",
  });

  const restored = openDurableCore(input.databasePath);
  assert.equal(restored.facts.schemaVersion, 48);
  verifyInstallationKey(restored, input.masterKey);
  restored.close();
});

test("a validated snapshot replaces a missing stopped target", async () => {
  const input = await restoreFixture();
  rmSync(input.databasePath);

  await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath: input.databasePath,
    manifestPath: input.backup.manifestPath,
    masterKey: input.masterKey,
    operatorPassword: "a replacement operator password",
  });

  assert.equal(existsSync(input.databasePath), true);
  const restored = openDurableCore(input.databasePath);
  verifyInstallationKey(restored, input.masterKey);
  restored.close();
});

test("a compatible current schema produced by migration remains restorable", async () => {
  const input = await restoreFixture();
  const migrated = new DatabaseSync(input.backup.databasePath);
  migrated.exec(`
    DROP TRIGGER evaluation_applicability_seal_complete_update;
    ALTER TABLE reviews DROP COLUMN archived_at;
    ALTER TABLE reviews ADD COLUMN archived_at INTEGER;
    ${APPLICABILITY_SEAL_SCHEMA}
  `);
  migrated.close();
  const current = openDurableCore(input.databasePath);
  current.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('post_backup_fact', 'must-disappear')",
  );
  current.close();

  await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath: input.databasePath,
    manifestPath: input.backup.manifestPath,
    masterKey: input.masterKey,
    operatorPassword: "a replacement operator password",
  });

  const restored = openDurableCore(input.databasePath);
  assert.equal(
    restored.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
    ),
    undefined,
  );
  restored.close();
});
