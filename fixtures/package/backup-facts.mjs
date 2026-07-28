import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const backupsPath = "/var/backups/quality-bar";
const encodedMasterKey = process.argv[2];
if (!encodedMasterKey) {
  throw new Error("package_backup_probe_master_key_missing");
}
const manifestFiles = readdirSync(backupsPath).filter(
  (file) => file.startsWith("quality-bar-daily-") && file.endsWith(".json"),
);
if (manifestFiles.length !== 1) {
  throw new Error(
    `package_backup_probe_daily_count_invalid: ${manifestFiles.length}`,
  );
}
const manifestPath = join(backupsPath, manifestFiles[0]);
const manifestSource = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
const databasePath = join(backupsPath, manifest.database_file);
const databaseSource = readFileSync(databasePath);
const database = new DatabaseSync(databasePath, { readOnly: true });
const integrity = database
  .prepare("PRAGMA integrity_check")
  .get()?.integrity_check;
database.close();

console.log(
  JSON.stringify({
    applicationVersion: manifest.application_version,
    count: manifestFiles.length,
    integrity,
    keyIdentity: manifest.installation_key_identity,
    kind: manifest.kind,
    masterKeyCopied:
      manifestSource.includes(encodedMasterKey) ||
      databaseSource.includes(Buffer.from(encodedMasterKey)),
    schemaVersion: manifest.schema_version,
  }),
);
