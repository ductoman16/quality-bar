import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
/** @param {string} sql @param {string} field */
const scalar = (sql, field) => {
  const row = database.prepare(sql).get();
  if (!row) {
    throw new Error(`package_probe_scalar_missing: ${field}`);
  }
  return row[field];
};
/** @param {string} key */
const metadata = (key) =>
  database
    .prepare("SELECT value FROM quality_bar_metadata WHERE key = ?")
    .get(key)?.value ?? null;

const synchronous = scalar("PRAGMA synchronous", "synchronous");
if (typeof synchronous !== "number") {
  throw new Error("package_probe_synchronous_not_numeric");
}

console.log(
  JSON.stringify({
    databaseVersion: scalar("SELECT sqlite_version() AS version", "version"),
    activeBrowserSessions: scalar(
      "SELECT COUNT(*) AS count FROM browser_sessions",
      "count",
    ),
    activeImplementerToken: metadata("implementer_token_verifier") !== null,
    failedLoginAttempts: metadata("failed_operator_login_attempts"),
    failedLoginUntil: metadata("failed_operator_login_until"),
    foreignKeys:
      (database.exec("PRAGMA foreign_keys = ON"),
      scalar("PRAGMA foreign_keys", "foreign_keys") === 1),
    installationKeyVerifier: metadata("installation_key_verifier"),
    integrity: scalar("PRAGMA integrity_check", "integrity_check"),
    journalMode: scalar("PRAGMA journal_mode", "journal_mode"),
    operatorPasswordVerifier: metadata("operator_password_verifier"),
    persistedMarker: metadata("package_persistence_test"),
    restoredDiscovery: {
      forgejo:
        database
          .prepare(
            `SELECT baseline_status FROM forgejo_repository_polls
              WHERE connection_id = 'package-restored-forgejo'`,
          )
          .get()?.baseline_status ?? null,
      github:
        database
          .prepare(
            `SELECT baseline_status FROM github_repository_polls
              WHERE connection_id = 'package-restored-github'`,
          )
          .get()?.baseline_status ?? null,
    },
    synchronous: { 0: "off", 1: "normal", 2: "full", 3: "extra" }[synchronous],
  }),
);
database.close();
