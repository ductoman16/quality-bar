import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  createApplicationLogWriter,
  createApplicationSecretRegistry,
  sanitizeStructuredLogLine,
} from "../src/application-log.js";

test("ordinary logs redact owned credential shapes without scanning retained transcript content", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-log-security-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  const secret = "owned-token-value";
  /** @type {string[]} */
  const hostLogs = [];
  const writeLog = createApplicationLogWriter({
    hostWriter: (line) => hostLogs.push(line),
    readDurableCore: () => core,
    knownSecrets: [secret],
  });
  const transcript = `Repository material may contain ${secret}`;

  writeLog(
    `${JSON.stringify({
      timestamp: new Date(100).toISOString(),
      severity: "error",
      event: "credential_failure",
      component: "security",
      outcome: "failure",
      error: "credential_verification_failed",
      detail: `Authorization: Bearer ${secret}; URL https://user:${secret}@example.test`,
      request_body: transcript,
      transcript,
    })}\n`,
  );

  assert.doesNotMatch(hostLogs.join(""), new RegExp(secret));
  assert.doesNotMatch(hostLogs.join(""), /Repository material/);
  const stored = core.get(
    `SELECT message, request_id, repository_id, evaluation_id
     FROM application_logs
     WHERE event = ?`,
    "credential_failure",
  );
  assert.ok(stored);
  assert.doesNotMatch(String(stored.message), new RegExp(secret));
  assert.doesNotMatch(String(stored.message), /Repository material/);
  assert.equal(stored.request_id, null);
  assert.equal(stored.repository_id, null);
  assert.equal(stored.evaluation_id, null);
});

test("ordinary log redaction observes secrets registered after writer creation", () => {
  const { knownSecrets, registerSecret } = createApplicationSecretRegistry();
  /** @type {string[]} */
  const hostLogs = [];
  const writeLog = createApplicationLogWriter({
    hostWriter: (line) => hostLogs.push(line),
    readDurableCore: () => null,
    knownSecrets,
  });
  registerSecret("registered-after-writer");
  writeLog(
    `${JSON.stringify({
      timestamp: new Date(100).toISOString(),
      severity: "error",
      event: "registered_secret_failure",
      component: "security",
      outcome: "failure",
      detail: "registered-after-writer",
    })}\n`,
  );
  assert.doesNotMatch(hostLogs.join(""), /registered-after-writer/);
});

test("ordinary log normalization removes request bodies and transcripts", () => {
  const line = sanitizeStructuredLogLine(
    `${JSON.stringify({
      timestamp: new Date(100).toISOString(),
      severity: "info",
      event: "safe_event",
      component: "test",
      outcome: "success",
      request_body: "must not be logged",
      transcript: "must remain in the transcript store only",
    })}\n`,
  );
  assert.doesNotMatch(line, /must not be logged/);
  assert.doesNotMatch(line, /transcript store/);
  assert.match(line, /"event":"safe_event"/);
});

test("ordinary logs redact opaque credential assignments without a secret registry", () => {
  const line = sanitizeStructuredLogLine(
    `${JSON.stringify({
      timestamp: new Date(100).toISOString(),
      severity: "error",
      event: "credential_failure",
      component: "security",
      outcome: "failure",
      detail: "token=opaque-owned-token password:opaque-password",
    })}\n`,
  );
  assert.doesNotMatch(line, /opaque-owned-token|opaque-password/);
  assert.match(line, /token: \[REDACTED\]/);
  assert.match(line, /password: \[REDACTED\]/);
});

test("ordinary logs redact cookie headers", () => {
  const line = sanitizeStructuredLogLine(
    `${JSON.stringify({
      timestamp: new Date(100).toISOString(),
      severity: "error",
      event: "cookie_failure",
      component: "security",
      outcome: "failure",
      detail:
        "Cookie: session=owned-cookie; preference=owned-preference; Set-Cookie: session=owned-cookie; HttpOnly",
    })}\n`,
  );
  assert.doesNotMatch(line, /owned-cookie|owned-preference/);
  assert.match(line, /Cookie: \[REDACTED\]/);
  assert.match(line, /Set-Cookie: \[REDACTED\]/);
});
