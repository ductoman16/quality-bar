import assert from "node:assert/strict";
import test from "node:test";
import addFormatsModule from "ajv-formats";
import AjvModule from "ajv";

import { canonicalEvaluationSchemas } from "../src/canonical-evaluation-components.js";

const Ajv = AjvModule.default;
const addFormats = addFormatsModule.default;
const schemas = canonicalEvaluationSchemas();
const ajv = new Ajv({ allowUnionTypes: true, strict: false });
addFormats(ajv);
const validate = ajv.compile({
  $ref: "#/components/schemas/WaiverAdjudicationOperational",
  components: { schemas },
});

const queued = {
  completed_at: null,
  decisions: [],
  exhausted_at: null,
  execution_status: "queued",
  followup: null,
  id: "adjudication-1",
  next_attempt_at: "2026-07-29T12:00:00.000Z",
  pre_start_attempt_count: 0,
  request_ids: ["request-1"],
  retry_cycle: 1,
  retry_error: null,
  retry_state: "ready",
  started_at: null,
};

test("operational waiver schema accepts only exact lifecycle and Decision variants", () => {
  assert.equal(validate(queued), true);
  for (const invalid of [
    {
      ...queued,
      decisions: [
        {
          explanation: "Cannot accompany an error.",
          id: "decision-1",
          outcome: "error",
          request_id: "request-1",
        },
      ],
    },
    {
      ...queued,
      completed_at: "2026-07-29T12:01:00.000Z",
      execution_status: "completed",
      next_attempt_at: null,
      started_at: "2026-07-29T12:00:00.000Z",
    },
    {
      ...queued,
      execution_status: "failed",
      next_attempt_at: null,
      started_at: "2026-07-29T12:00:00.000Z",
    },
  ]) {
    assert.equal(validate(invalid), false);
  }
});
