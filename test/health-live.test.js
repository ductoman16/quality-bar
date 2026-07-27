import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApplicationServer } from "../src/server.js";

/** @type {import("node:http").Server | undefined} */
let server;
/** @type {string | undefined} */
let origin;

/** @param {object} options */
function callApplicationServer(options) {
  return Reflect.apply(createApplicationServer, undefined, [options]);
}

before(async () => {
  const applicationServer = createApplicationServer({
    browserSessions: {
      authenticate() {
        return false;
      },
      isBootstrapped() {
        return false;
      },
      login() {
        throw new Error("unused browser session login");
      },
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
    implementerTokens: {
      authenticate() {
        return false;
      },
      create() {
        throw new Error("unused implementer token create");
      },
      hasActiveToken() {
        return false;
      },
      revoke() {},
      rotate() {
        throw new Error("unused implementer token rotate");
      },
    },
    listAuthorityAttributions: () => ({ items: [], next_cursor: null }),
    recordAuthorityAttribution() {},
    readDurableCoreStatus: () => ({ status: "ready" }),
    readSystemStatus: () => ({}),
    reviews: {
      list() {
        return [];
      },
      create() {
        throw new Error("unused review create");
      },
      saveVersion() {
        throw new Error("unused Review Version save");
      },
      updateMetadata() {
        throw new Error("unused Review metadata update");
      },
    },
    requestSecurity: {
      requestFacts() {
        throw new Error("unused request facts");
      },
    },
  });
  server = applicationServer;
  await new Promise((resolve, reject) => {
    applicationServer.once("error", reject);
    applicationServer.listen(0, "127.0.0.1", () => resolve(undefined));
  });

  const address = applicationServer.address();
  if (!address || typeof address === "string") {
    throw new Error("health_live_server_address_unavailable");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) {
    throw new Error("health_live_server_missing");
  }
  const applicationServer = server;
  await new Promise((resolve, reject) => {
    applicationServer.close((error) =>
      error ? reject(error) : resolve(undefined),
    );
  });
});

test("GET /health/live reports only process responsiveness", async () => {
  if (!origin) {
    throw new Error("health_live_origin_missing");
  }
  const response = await fetch(`${origin}/health/live`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { status: "live" });
});

test("the application server rejects a missing browser-session boundary", () => {
  assert.throws(
    () =>
      callApplicationServer({
        listAuthorityAttributions: () => ({ items: [], next_cursor: null }),
        recordAuthorityAttribution() {},
        readDurableCoreStatus: () => ({ status: "ready" }),
        readSystemStatus: () => ({}),
      }),
    (error) => {
      if (!(error instanceof Error)) {
        return false;
      }
      assert.equal(
        error.message,
        "browserSessions must provide the session boundary",
      );
      return true;
    },
  );
});

test("the application server rejects a missing request-security boundary", () => {
  assert.throws(
    () =>
      callApplicationServer({
        browserOrigin: "http://127.0.0.1:3000",
        browserSessions: {
          authenticate() {
            return false;
          },
          changePassword() {},
          isBootstrapped() {
            return false;
          },
          login() {
            throw new Error("unused browser session login");
          },
          logout() {},
          revokeAll() {},
          touch() {
            return false;
          },
          verifyCsrf() {
            return false;
          },
        },
        implementerTokens: {
          authenticate() {
            return false;
          },
          create() {
            throw new Error("unused implementer token create");
          },
          hasActiveToken() {
            return false;
          },
          revoke() {},
          rotate() {
            throw new Error("unused implementer token rotate");
          },
        },
        listAuthorityAttributions: () => ({ items: [], next_cursor: null }),
        recordAuthorityAttribution() {},
        readDurableCoreStatus: () => ({ status: "ready" }),
        readSystemStatus: () => ({}),
      }),
    (error) => {
      if (!(error instanceof Error)) {
        return false;
      }
      assert.equal(
        error.message,
        "requestSecurity must provide the request boundary",
      );
      return true;
    },
  );
});
