import assert from "node:assert/strict";
import { test } from "node:test";

import { readHttpPort } from "../src/http-port.ts";

test("accepts only complete valid decimal TCP port values", () => {
  assert.equal(readHttpPort("3000"), 3000);
  assert.equal(readHttpPort("65535"), 65535);

  for (const value of [
    undefined,
    "",
    "0",
    "65536",
    "3000junk",
    "3000.5",
    " 3000",
    "+3000",
  ]) {
    assert.throws(() => readHttpPort(value), {
      message: "QUALITY_BAR_HTTP_PORT must be a valid TCP port",
    });
  }
});
