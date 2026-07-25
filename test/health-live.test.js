import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApplicationServer } from "../src/server.js";

let server;
let origin;

before(async () => {
  server = createApplicationServer(() => ({ status: "ready" }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /health/live reports only process responsiveness", async () => {
  const response = await fetch(`${origin}/health/live`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { status: "live" });
});
