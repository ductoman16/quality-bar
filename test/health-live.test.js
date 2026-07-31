import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createUnavailableReviewService } from "../src/review.js";
import { createUnavailableEvaluationService } from "../src/evaluation.js";
import { createUnavailableGitHubConnectionService } from "../src/github-connection.js";
import { createApplicationServer } from "../src/server.js";
import { createUnavailableWaiverAdjudicatorConfigurationService } from "../src/waiver-adjudicator-configuration.js";

/** @type {import("node:http").Server | undefined} */
let server;
/** @type {string | undefined} */
let origin;

/** @param {object} options */
function callApplicationServer(options) {
  return Reflect.apply(createApplicationServer, undefined, [
    { workerSignal: new AbortController().signal, ...options },
  ]);
}

function applicationServerOptions() {
  return {
    workerSignal: new AbortController().signal,
    codexExecutionConcurrency: {
      read: () => 1,
      set: (/** @type {unknown} */ value) => value,
    },
    evaluations: createUnavailableEvaluationService(
      new Error("unused Evaluation"),
    ),
    forgejoConnections: {
      destroy() {},
      acquireRepositoryGitCredential() {
        throw new Error("unused Forgejo Connection");
      },
      async runPolling() {},
      requireFreshBaseline() {},
      startPolling() {},
      stopPolling() {},
      async discover() {
        throw new Error("unused Forgejo Connection");
      },
      async connect() {
        throw new Error("unused Forgejo Connection");
      },
      async rotate() {
        throw new Error("unused Forgejo Connection");
      },
      async prepareRepositoryEnablement() {
        throw new Error("unused Forgejo Connection");
      },
      async reactivate() {
        throw new Error("unused Forgejo Connection");
      },
      retire() {
        throw new Error("unused Forgejo Connection");
      },
      remove() {
        throw new Error("unused Forgejo Connection");
      },
      read() {
        throw new Error("unused Forgejo Connection");
      },
    },
    githubConnections: createUnavailableGitHubConnectionService(
      new Error("unused GitHub Connection"),
    ),
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
    recordMcpOperation() {},
    readDurableCoreStatus: () => ({ status: "ready" }),
    readSystemStatus: () => ({}),
    repositories: {
      async acquireGitCredential() {
        throw new Error("unused Repository service operation");
      },
      destroy() {},
      list() {
        throw new Error("unused Repository service operation");
      },
      listPage() {
        throw new Error("unused Repository service operation");
      },
      async register() {
        throw new Error("unused Repository service operation");
      },
      remove() {
        throw new Error("unused Repository service operation");
      },
      requireAcceptsNewWork() {
        throw new Error("unused Repository service operation");
      },
      async rotateCredential() {
        throw new Error("unused Repository service operation");
      },
      async setLifecycle() {
        throw new Error("unused Repository service operation");
      },
    },
    repositoryGuidance: {
      read() {
        throw new Error("unused Repository Guidance service operation");
      },
    },
    reviews: {
      ...createUnavailableReviewService(
        new Error("unused Review service operation"),
      ),
      list() {
        return [];
      },
    },
    requestSecurity: {
      requestFacts() {
        throw new Error("unused request facts");
      },
    },
    waiverAdjudicatorConfiguration:
      createUnavailableWaiverAdjudicatorConfigurationService(
        new Error("unused Waiver Adjudicator Configuration"),
      ),
  };
}

before(async () => {
  const applicationServer = createApplicationServer(applicationServerOptions());
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

test("the application server requires the Evaluation resource boundary", () => {
  assert.throws(
    () =>
      callApplicationServer({
        ...applicationServerOptions(),
        evaluations: undefined,
      }),
    /evaluations must provide the Evaluation resource/,
  );
});

test("the application server rejects an Evaluation resource without error retry", () => {
  const options = applicationServerOptions();
  const evaluations = { ...options.evaluations };
  Reflect.deleteProperty(evaluations, "retryWaiverErrors");

  assert.throws(
    () =>
      callApplicationServer({
        ...options,
        evaluations,
      }),
    /evaluations must provide the Evaluation resource/,
  );
});

test("the application server rejects an incomplete Repository resource boundary", () => {
  const options = applicationServerOptions();
  assert.throws(
    () =>
      callApplicationServer({
        ...options,
        repositories: {
          destroy() {},
          async register() {
            throw new Error("unused Repository service operation");
          },
          async rotateCredential() {
            throw new Error("unused Repository service operation");
          },
        },
      }),
    /repositories must provide the Repository resource/,
  );
});

test("the application server rejects an incomplete Forgejo Connection boundary", () => {
  const options = applicationServerOptions();
  assert.throws(
    () =>
      callApplicationServer({
        ...options,
        forgejoConnections: {
          ...options.forgejoConnections,
          rotate: undefined,
        },
      }),
    /forgejoConnections must provide the Forgejo Connection resource/,
  );
});
