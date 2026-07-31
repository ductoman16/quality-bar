import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { acquireInstallationLock } from "../../src/installation-environment.js";
import {
  finalizePreMigrationBackup,
  preparePreMigrationBackup,
} from "../../src/installed-backup.js";
import { openDurableCore } from "../../src/durable-core.js";
import { SCHEMA_VERSION } from "../../src/durable-schema.js";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../../src/sqlite-backup.js";
import { retainLatestValidatedBackups } from "../../src/validated-backup.js";

const [applicationVersion, encodedMasterKey] = process.argv.slice(2);
if (!applicationVersion || !encodedMasterKey) {
  throw new Error("package_upgrade_arguments_invalid");
}

const databasePath = "/var/lib/quality-bar/quality-bar.sqlite3";
const backupsPath = "/var/backups/quality-bar";
const keyIdentity = installationKeyIdentity(
  Buffer.from(encodedMasterKey, "base64"),
);
const releaseInstallationLock = acquireInstallationLock(
  (path) => new DatabaseSync(path),
);
const priorImageVersion = "0.0.9";

try {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("DROP TABLE application_logs");
  database
    .prepare("UPDATE quality_bar_metadata SET value = ? WHERE key = ?")
    .run("47", "schema_version");
  database.exec("PRAGMA user_version = 47");
  await createValidatedBackup({
    applicationVersion: priorImageVersion,
    backupsPath,
    database,
    keyIdentity,
    kind: "daily",
    now: () => Date.parse("2026-07-29T01:02:03.000Z"),
  });
  database.close();

  const preMigration = await preparePreMigrationBackup({
    backupsPath,
    databasePath,
    keyIdentity,
    targetSchemaVersion: SCHEMA_VERSION,
  });
  if (!preMigration) {
    throw new Error("package_upgrade_pre_migration_snapshot_missing");
  }
  const manifest = JSON.parse(readFileSync(preMigration.manifestPath, "utf8"));
  const migrated = openDurableCore(databasePath);
  const afterSchemaVersion = migrated.facts.schemaVersion;
  const restoredTable = migrated.get(
    "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'application_logs'",
  );
  migrated.close();
  finalizePreMigrationBackup(backupsPath);
  retainLatestValidatedBackups({ backupsPath, keep: 1, kind: "daily" });

  process.stdout.write(
    `${JSON.stringify({
      explicitImage: applicationVersion.length > 0,
      forwardMigration: {
        afterSchemaVersion,
        beforeSchemaVersion: manifest.schema_version,
        exclusive: true,
        restoredTable: Boolean(restoredTable),
      },
      noAutomaticUpdate: applicationVersion.length > 0,
      preMigrationSnapshot: {
        applicationVersion: manifest.application_version,
        kind: manifest.kind,
        schemaVersion: manifest.schema_version,
      },
      rollback: {
        downgradeMigration: false,
        priorImageRequired: true,
        priorImageVersion: manifest.application_version,
      },
    })}\n`,
  );
} finally {
  releaseInstallationLock();
}
