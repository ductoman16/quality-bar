import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { evaluationCancellationMigration } from "../src/evaluation-schema.js";

test("schema v33 Evaluation work gains nullable cancellation facts without invention", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE evaluations (
      id TEXT PRIMARY KEY,
      execution_status TEXT NOT NULL
    ) STRICT;
    INSERT INTO evaluations (id, execution_status)
    VALUES ('evaluation-v33', 'queued');
  `);
  database.exec(evaluationCancellationMigration(database));
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT execution_status, cancellation_requested_at,
                  cancellation_code, cancellation_detail
           FROM evaluations WHERE id = 'evaluation-v33'`,
        )
        .get(),
    },
    {
      cancellation_code: null,
      cancellation_detail: null,
      cancellation_requested_at: null,
      execution_status: "queued",
    },
  );
  assert.equal(evaluationCancellationMigration(database), "");
  database.close();
});
