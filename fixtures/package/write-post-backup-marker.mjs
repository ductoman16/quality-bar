import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
database
  .prepare(
    "UPDATE quality_bar_metadata SET value = ? WHERE key = 'package_persistence_test'",
  )
  .run("post-backup");
database.close();
