import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
database
  .prepare("INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)")
  .run("package_persistence_test", "survived");
database.close();
