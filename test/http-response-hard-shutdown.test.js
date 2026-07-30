import assert from "node:assert/strict";
import test from "node:test";

import { writeError, writeJson } from "../src/http-response.js";
import { runIoOperation } from "../src/io-operation-context.js";

test("hard shutdown rejects a late product result but permits its exact error", () => {
  const workers = new AbortController();
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  workers.abort(failure);
  /** @type {any[]} */
  const responses = [];
  const response = /** @type {any} */ ({
    /** @param {string} body */
    end(body) {
      responses.push({ body });
    },
    /** @param {number} status @param {Record<string, string>} headers */
    writeHead(status, headers) {
      responses.push({ headers, status });
    },
  });

  runIoOperation(workers.signal, () => {
    assert.throws(
      () => writeJson(response, 200, { stale: true }),
      (error) => error === failure,
    );
    writeError(
      response,
      503,
      "storage_unavailable",
      "SQLite durable write failed",
    );
  });

  assert.equal(responses[0].status, 503);
  assert.deepEqual(responses[0].headers, {
    "content-type": "application/json",
  });
  assert.match(responses[1].body, /"code":"storage_unavailable"/);
  assert.doesNotMatch(responses[1].body, /"stale"/);
});
