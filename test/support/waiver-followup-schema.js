import { WAIVER_FOLLOWUP_REBUILD_CLEANUP } from "../../src/waiver-followup-schema.js";

/** @param {{run: (sql: string) => unknown}} access */
export function removeWaiverFollowupSchema(access) {
  for (const statement of WAIVER_FOLLOWUP_REBUILD_CLEANUP.split(";")) {
    if (statement.trim()) {
      access.run(statement);
    }
  }
}
