import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
const now = Date.now();
const old = now - 91 * 24 * 60 * 60 * 1_000;
const recent = now - 89 * 24 * 60 * 60 * 1_000;
const mode = process.argv[2] ?? "probe";
if (mode !== "seed" && mode !== "probe") {
  throw new Error("package_retention_mode_invalid");
}
/** @param {string} sql */
const count = (sql) => {
  const row = database.prepare(sql).get();
  if (!row) {
    throw new Error("package_retention_count_missing");
  }
  return row.count;
};

if (mode === "seed") {
  database
    .prepare(
      `INSERT INTO application_logs (
       id, occurred_at, severity, event, component, outcome, message
     ) VALUES (?, ?, 'info', ?, 'package', 'success', ?)`,
    )
    .run("package-retention-old", old, "package_retention_old", "old detail");
  database
    .prepare(
      `INSERT INTO application_logs (
       id, occurred_at, severity, event, component, outcome, message
     ) VALUES (?, ?, 'info', ?, 'package', 'success', ?)`,
    )
    .run(
      "package-retention-recent",
      recent,
      "package_retention_recent",
      "recent detail",
    );
  database
    .prepare(
      `INSERT OR REPLACE INTO quality_bar_metadata (key, value)
     VALUES ('package_retention_canonical', 'survived')`,
    )
    .run();
  process.stdout.write(`${JSON.stringify({ status: "seeded" })}\n`);
} else {
  process.stdout.write(
    `${JSON.stringify({
      canonical:
        database
          .prepare(
            "SELECT value FROM quality_bar_metadata WHERE key = 'package_retention_canonical'",
          )
          .get()?.value ?? null,
      oldCount: count(
        "SELECT count(*) AS count FROM application_logs WHERE id = 'package-retention-old'",
      ),
      recentCount: count(
        "SELECT count(*) AS count FROM application_logs WHERE id = 'package-retention-recent'",
      ),
    })}\n`,
  );
}
database.close();
