import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const [port] = process.argv.slice(2);
const password = await readFile("/dev/stdin", "utf8");
const endpoint = `http://127.0.0.1:${port}`;
const forwarded = {
  forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
};

/** @param {string} path @param {RequestInit} [options] */
async function responseFacts(path, options) {
  const response = await fetch(`${endpoint}${path}`, options);
  return {
    body: /** @type {any} */ (await response.json()),
    status: response.status,
  };
}

const blocker = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
blocker.exec("BEGIN IMMEDIATE");
let failedWrite;
try {
  failedWrite = await responseFacts("/api/v1/session/login", {
    body: JSON.stringify({ password }),
    headers: { ...forwarded, "content-type": "application/json" },
    method: "POST",
  });
} finally {
  blocker.exec("ROLLBACK");
  blocker.close();
}

const browser = await responseFacts("/", { headers: forwarded });
const browserAsset = await responseFacts("/assets/login.js", {
  headers: forwarded,
});
const api = await responseFacts("/api/v1/system", { headers: forwarded });
const mcp = await responseFacts("/mcp/v1", { headers: forwarded });
const liveness = await responseFacts("/health/live");
const readiness = await responseFacts("/health/ready");

process.stdout.write(
  `${JSON.stringify({
    api: { errorCode: api.body.error.code, status: api.status },
    browser: {
      errorCode: browser.body.error.code,
      status: browser.status,
    },
    browserAsset: {
      errorCode: browserAsset.body.error.code,
      status: browserAsset.status,
    },
    failedWrite: {
      errorCode: failedWrite.body.error.code,
      status: failedWrite.status,
    },
    liveness,
    mcp: { errorCode: mcp.body.error.code, status: mcp.status },
    readiness,
  })}\n`,
);
