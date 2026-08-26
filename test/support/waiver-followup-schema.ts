import { WAIVER_FOLLOWUP_REBUILD_CLEANUP } from "../../src/waiver/waiver-followup-schema.ts";

export function removeWaiverFollowupSchema(access: {
  run: (sql: string) => unknown;
}) {
  for (const statement of WAIVER_FOLLOWUP_REBUILD_CLEANUP.split(";")) {
    if (statement.trim()) {
      access.run(statement);
    }
  }
}
