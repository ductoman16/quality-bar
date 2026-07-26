import { DatabaseSync } from "node:sqlite";

const lockPath = process.argv[2];
if (!lockPath) {
  throw new Error("sqlite_lock_contender_path_missing");
}

const lock = new DatabaseSync(lockPath);
try {
  lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  process.exitCode = 1;
} catch {
  process.exitCode = 0;
} finally {
  lock.close();
}
