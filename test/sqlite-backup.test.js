import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-backup-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("creates an integrity-checked backup with schema, application, and key identity", async () => {
  const directory = temporaryDirectory();
  const databasePath = join(directory, "quality-bar.sqlite3");
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA user_version = 53;
    CREATE TABLE facts (value TEXT PRIMARY KEY) STRICT;
    INSERT INTO facts (value) VALUES ('retained');
  `);
  const masterKey = Buffer.alloc(32, 7);
  const keyIdentity = installationKeyIdentity(masterKey);

  const result = await createValidatedBackup({
    applicationVersion: "1.2.3",
    backupsPath,
    database,
    keyIdentity,
    kind: "daily",
    now: () => Date.parse("2026-07-28T12:34:56.789Z"),
  });

  assert.deepEqual(result, {
    applicationVersion: "1.2.3",
    createdAt: "2026-07-28T12:34:56.789Z",
    databasePath: join(
      backupsPath,
      "quality-bar-daily-2026-07-28T12-34-56-789Z.sqlite3",
    ),
    keyIdentity,
    kind: "daily",
    manifestPath: join(
      backupsPath,
      "quality-bar-daily-2026-07-28T12-34-56-789Z.json",
    ),
    schemaVersion: 53,
  });
  assert.deepEqual(readdirSync(backupsPath).sort(), [
    "quality-bar-daily-2026-07-28T12-34-56-789Z.json",
    "quality-bar-daily-2026-07-28T12-34-56-789Z.sqlite3",
  ]);
  assert.deepEqual(JSON.parse(readFileSync(result.manifestPath, "utf8")), {
    application_version: "1.2.3",
    created_at: "2026-07-28T12:34:56.789Z",
    database_file: "quality-bar-daily-2026-07-28T12-34-56-789Z.sqlite3",
    installation_key_identity: keyIdentity,
    kind: "daily",
    schema_version: 53,
  });
  const backup = new DatabaseSync(result.databasePath, { readOnly: true });
  assert.equal(
    backup.prepare("PRAGMA integrity_check").get()?.integrity_check,
    "ok",
  );
  assert.equal(
    backup.prepare("SELECT value FROM facts").get()?.value,
    "retained",
  );
  backup.close();
  database.close();
});

test("discards incomplete output and preserves the exact online backup failure", async () => {
  const directory = temporaryDirectory();
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 53");
  const onlineBackupFailure = Object.assign(
    new Error("destination write failed"),
    { code: "SQLITE_IOERR_WRITE" },
  );

  await assert.rejects(
    createValidatedBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      database,
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      now: () => Date.parse("2026-07-28T12:34:56.789Z"),
      performBackup: async (sourceDatabase, destinationPath) => {
        void sourceDatabase;
        writeFileSync(destinationPath, "incomplete");
        throw onlineBackupFailure;
      },
    }),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "SQLITE_IOERR_WRITE");
      assert.equal(error.message, "destination write failed");
      assert.equal(error.cause, onlineBackupFailure);
      return true;
    },
  );

  assert.equal(
    existsSync(
      join(backupsPath, "quality-bar-daily-2026-07-28T12-34-56-789Z.sqlite3"),
    ),
    false,
  );
  assert.deepEqual(readdirSync(backupsPath), []);
  database.close();
});

test("hard shutdown aborts an online backup and discards its incomplete output", async () => {
  const directory = temporaryDirectory();
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 53");
  const workers = new AbortController();
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });

  await assert.rejects(
    createValidatedBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      database,
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      now: () => Date.parse("2026-07-28T12:34:56.789Z"),
      performBackup: async (sourceDatabase, destinationPath, options) => {
        void sourceDatabase;
        writeFileSync(destinationPath, "incomplete");
        workers.abort(failure);
        options?.progress?.({ remainingPages: 1, totalPages: 1 });
        return 1;
      },
      signal: workers.signal,
    }),
    (error) => error === failure,
  );

  assert.deepEqual(readdirSync(backupsPath), []);
  database.close();
});

test("hard shutdown surfaces failed cancellation cleanup distinctly", async () => {
  const directory = temporaryDirectory();
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 53");
  const workers = new AbortController();
  const cancellation = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  const cleanupFailure = Object.assign(new Error("remove failed"), {
    code: "EACCES",
  });

  await assert.rejects(
    createValidatedBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      database,
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      now: () => Date.parse("2026-07-28T12:34:56.789Z"),
      performBackup: async (sourceDatabase, destinationPath, options) => {
        void sourceDatabase;
        writeFileSync(destinationPath, "incomplete");
        workers.abort(cancellation);
        options?.progress?.({ remainingPages: 1, totalPages: 1 });
        return 1;
      },
      removeBackupOutput() {
        throw cleanupFailure;
      },
      signal: workers.signal,
    }),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "backup_invalid_output_cleanup_failed");
      assert.equal(
        error.message,
        "Canceled SQLite backup output could not be discarded",
      );
      assert.notEqual(error, cancellation);
      assert.ok(error.cause instanceof AggregateError);
      assert.equal(error.cause.errors[0], cancellation);
      assert.equal(error.cause.errors.length, 5);
      assert.equal(
        error.cause.errors.slice(1).every((item) => item === cleanupFailure),
        true,
      );
      return true;
    },
  );

  assert.equal(readdirSync(backupsPath).length, 1);
  database.close();
});

test("retains only the seven latest successful daily backups", async () => {
  const directory = temporaryDirectory();
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 53");
  const keyIdentity = installationKeyIdentity(Buffer.alloc(32, 7));

  for (let day = 1; day <= 8; day += 1) {
    await createValidatedBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      database,
      keyIdentity,
      kind: "daily",
      now: () =>
        Date.parse(`2026-07-${String(day).padStart(2, "0")}T00:00:00Z`),
    });
  }

  const retained = readdirSync(backupsPath).sort();
  assert.equal(retained.length, 14);
  assert.equal(
    retained.some((file) => file.includes("2026-07-01T00-00-00-000Z")),
    false,
  );
  assert.equal(retained.filter((file) => file.endsWith(".sqlite3")).length, 7);
  assert.equal(retained.filter((file) => file.endsWith(".json")).length, 7);
  database.close();
});

test("a timestamp collision preserves the existing successful backup", async () => {
  const directory = temporaryDirectory();
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 53");
  const input = {
    applicationVersion: "1.2.3",
    backupsPath,
    database,
    keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
    kind: /** @type {const} */ ("daily"),
    now: () => Date.parse("2026-07-28T12:34:56.789Z"),
  };
  const existing = await createValidatedBackup(input);
  const existingManifest = readFileSync(existing.manifestPath, "utf8");
  const existingDatabase = readFileSync(existing.databasePath);

  await assert.rejects(createValidatedBackup(input), (error) => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal(error.code, "backup_destination_exists");
    return true;
  });

  assert.equal(readFileSync(existing.manifestPath, "utf8"), existingManifest);
  assert.deepEqual(readFileSync(existing.databasePath), existingDatabase);
  database.close();
});
