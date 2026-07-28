import { DatabaseSync } from "node:sqlite";

import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../../src/sqlite-backup.js";

const [applicationVersion, encodedMasterKey] = process.argv.slice(2);
if (!applicationVersion || !encodedMasterKey) {
  throw new Error("package_restore_snapshot_arguments_missing");
}
const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
try {
  const backup = await createValidatedBackup({
    applicationVersion,
    backupsPath: "/var/backups/quality-bar",
    database,
    keyIdentity: installationKeyIdentity(
      Buffer.from(encodedMasterKey, "base64"),
    ),
    kind: "daily",
    now: () => Date.parse("2026-07-29T00:00:00.000Z"),
  });
  process.stdout.write(
    `${JSON.stringify({ manifestPath: backup.manifestPath })}\n`,
  );
} finally {
  database.close();
}
