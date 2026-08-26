import assert from "node:assert/strict";
import test from "node:test";

import { writeError, writeJson, writeStatus } from "../src/http-response.ts";
import { runIoOperation } from "../src/io-operation-context.ts";

test("hard shutdown rejects a late product result but permits its exact error", () => {
  const workers = new AbortController();
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  workers.abort(failure);
  const responses: any[] = [];
  const response = {
    code(status: number) {
      responses.push({ status });
      return this;
    },
    headers(headers: Record<string, string>) {
      responses.at(-1).headers = headers;
      return this;
    },
    type(type: string) {
      responses.at(-1).type = type;
      return this;
    },
    send(body: unknown) {
      responses.at(-1).body = body;
    },
  } as any;

  runIoOperation(workers.signal, () => {
    assert.throws(
      () => writeJson(response, 200, { stale: true }),
      (error) => error === failure,
    );
    assert.throws(
      () => writeError(response, 400, "request_malformed", "Wrong response"),
      (error) => error === failure,
    );
    assert.throws(
      () => writeStatus(response, 202),
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
  assert.deepEqual(responses[0].headers, {});
  assert.equal(responses[0].type, "application/json");
  assert.equal(responses[0].body.error.code, "storage_unavailable");
  assert.equal("stale" in responses[0].body, false);
});
