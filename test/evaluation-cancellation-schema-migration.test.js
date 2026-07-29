import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { EVALUATION_CANCELLATION_TRIGGERS } from "../src/evaluation-cancellation-schema.js";
import { evaluationCancellationMigration } from "../src/evaluation-schema.js";

test("schema v33 Evaluation work gains nullable cancellation facts without invention", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE evaluations (
      id TEXT PRIMARY KEY,
      execution_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    ) STRICT;
    INSERT INTO evaluations (id, execution_status, created_at)
    VALUES ('evaluation-v33', 'queued', 1);
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
  database.exec(EVALUATION_CANCELLATION_TRIGGERS);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO evaluations (
          id, execution_status, created_at, cancellation_requested_at,
          completed_at, cancellation_detail
        ) VALUES (
          'evaluation-invalid-cancellation', 'cancelled', 2, 3, 3,
          'Evaluation was cancelled by the operator'
        );
      `),
    /evaluation_cancellation_invalid/,
  );
  database.exec(`
    INSERT INTO evaluations (
      id, execution_status, created_at, cancellation_requested_at,
      completed_at, cancellation_code, cancellation_detail
    ) VALUES (
      'evaluation-valid-cancellation', 'cancelled', 2, 3, 3,
      'cancelled_by_operator', 'Evaluation was cancelled by the operator'
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE evaluations
        SET cancellation_detail = 'rewritten'
        WHERE id = 'evaluation-valid-cancellation';
      `),
    /evaluation_cancellation_immutable/,
  );
  database.close();
});

test("schema v33 rejects cancelled Evaluation rows whose exact facts never existed", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE evaluations (
      id TEXT PRIMARY KEY,
      execution_status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO evaluations (id, execution_status, created_at)
    VALUES ('evaluation-v33-cancelled', 'cancelled', 1);
  `);
  assert.throws(
    () => evaluationCancellationMigration(database),
    /Legacy cancelled Evaluation lacks exact cancellation facts/,
  );
  assert.deepEqual(
    database
      .prepare("PRAGMA table_info(evaluations)")
      .all()
      .map((column) => column.name),
    ["id", "execution_status", "created_at"],
  );
  database.close();
});
