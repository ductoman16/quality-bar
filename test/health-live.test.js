import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApplicationServer } from "../src/server.js";

let server;
let origin;

before(async () => {
  server = createApplicationServer({
    browserSessions: {
      authenticate() {
        return false;
      },
      isBootstrapped() {
        return false;
      },
      login() {},
      logout() {},
      changePassword() {},
      revokeAll() {},
      touch() {
        return false;
      },
      verifyCsrf() {
        return false;
      },
    },
    browserOrigin: "http://127.0.0.1:3000",
    readDurableCoreStatus: () => ({ status: "ready" }),
    requestSecurity: { requestFacts() {} },
  });
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

test("the application server rejects a missing browser-session boundary", () => {
  assert.throws(
    () =>
      createApplicationServer({
        readDurableCoreStatus: () => ({ status: "ready" }),
      }),
    (error) => {
      assert.equal(error.message, "browserSessions must provide the session boundary");
      return true;
    },
  );
});

test("the application server rejects a missing request-security boundary", () => {
  assert.throws(
    () =>
      createApplicationServer({
        browserOrigin: "http://127.0.0.1:3000",
        browserSessions: {
          authenticate() {
            return false;
          },
          changePassword() {},
          isBootstrapped() {
            return false;
          },
          login() {},
          logout() {},
          revokeAll() {},
          touch() {
            return false;
          },
          verifyCsrf() {
            return false;
          },
        },
        readDurableCoreStatus: () => ({ status: "ready" }),
      }),
    (error) => {
      assert.equal(error.message, "requestSecurity must provide the request boundary");
      return true;
    },
  );
});
