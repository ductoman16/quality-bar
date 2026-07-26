import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
const scalar = (sql, field) => database.prepare(sql).get()[field];
const metadata = (key) =>
  database
    .prepare("SELECT value FROM quality_bar_metadata WHERE key = ?")
    .get(key)?.value ?? null;

console.log(
  JSON.stringify({
    databaseVersion: scalar("SELECT sqlite_version() AS version", "version"),
    foreignKeys:
      (database.exec("PRAGMA foreign_keys = ON"),
      scalar("PRAGMA foreign_keys", "foreign_keys") === 1),
    installationKeyVerifier: metadata("installation_key_verifier"),
    integrity: scalar("PRAGMA integrity_check", "integrity_check"),
    journalMode: scalar("PRAGMA journal_mode", "journal_mode"),
    operatorPasswordVerifier: metadata("operator_password_verifier"),
    persistedMarker: metadata("package_persistence_test"),
    schemaVersion: scalar("PRAGMA user_version", "user_version"),
    synchronous: { 0: "off", 1: "normal", 2: "full", 3: "extra" }[
      scalar("PRAGMA synchronous", "synchronous")
    ],
  }),
);
database.close();
