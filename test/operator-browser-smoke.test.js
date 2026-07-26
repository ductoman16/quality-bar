import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createApplication } from "../src/application.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function firefoxBinary() {
  const binary =
    process.env.QUALITY_BAR_FIREFOX_BINARY ??
    (process.platform === "darwin"
      ? "/Applications/Firefox.app/Contents/MacOS/firefox"
      : "/usr/bin/firefox");
  assert.ok(existsSync(binary), `Firefox is required at ${binary}`);
  return binary;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function automatedLoginPage(body) {
  return Buffer.from(
    body
      .toString("utf8")
      .replace(
        "</body>",
        '<script src="/operator-browser-login.js"></script></body>',
      ),
  );
}

function automatedLoginScript() {
  return readFileSync(
    new URL("../fixtures/operator-browser-login.js", import.meta.url),
    "utf8",
  );
}

function waitFor(value, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("operator browser smoke timed out")),
      timeoutMs,
    );
    value.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Firefox completes the fixed authenticated operator-browser plumbing smoke", async () => {
  const directory = temporaryDirectory("quality-bar-operator-browser-");
  const databasePath = join(directory, "quality-bar.sqlite3");
  const application = createApplication({
    databasePath,
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    validateInstallation: () => ({}),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication() {},
    writeLog() {},
  });
  bootstrapOperatorPassword(
    application.durableCore,
    "a correct operator password",
  );
  await listen(application.server);
  const applicationOrigin = `http://127.0.0.1:${application.server.address().port}`;
  let sawAuthenticatedShell = false;
  let sawSystemFetch = false;
  let complete;
  const completed = new Promise((resolve) => {
    complete = resolve;
  });
  const proxy = createServer(async (request, response) => {
    if (
      request.method === "GET" &&
      request.url === "/operator-browser-login.js"
    ) {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(automatedLoginScript());
      return;
    }
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await readBody(request);
    const headers = {};
    if (request.headers.cookie) {
      headers.cookie = request.headers.cookie;
    }
    if (request.headers["content-type"]) {
      headers["content-type"] = request.headers["content-type"];
    }
    const upstream = await fetch(`${applicationOrigin}${request.url}`, {
      body,
      headers,
      method: request.method,
    });
    let responseBody = Buffer.from(await upstream.arrayBuffer());
    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    if (
      request.method === "GET" &&
      request.url === "/" &&
      !request.headers.cookie &&
      contentType.startsWith("text/html")
    ) {
      responseBody = automatedLoginPage(responseBody);
    }
    response.writeHead(upstream.status, {
      "content-type": contentType,
      ...(upstream.headers.getSetCookie().length > 0
        ? { "set-cookie": upstream.headers.getSetCookie() }
        : {}),
    });
    response.end(responseBody);
    if (request.url === "/" && request.headers.cookie) {
      sawAuthenticatedShell = true;
    }
    if (request.url === "/api/v1/system" && request.headers.cookie) {
      sawSystemFetch = true;
    }
    if (sawAuthenticatedShell && sawSystemFetch) {
      complete();
    }
  });
  await listen(proxy);
  const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;
  const firefox = spawn(firefoxBinary(), [
    "--headless",
    "--no-remote",
    "--profile",
    join(directory, "firefox-profile"),
    `${proxyOrigin}/`,
  ]);

  try {
    await waitFor(completed);
    assert.equal(sawAuthenticatedShell, true);
    assert.equal(sawSystemFetch, true);
  } finally {
    firefox.kill("SIGTERM");
    await close(proxy);
    await application.close();
  }
  console.log(
    `QUALITY_BAR_OPERATOR_BROWSER_FACTS ${JSON.stringify({
      authenticatedShell: sawAuthenticatedShell,
      engine: "firefox",
      executableVersion: execFileSync(firefoxBinary(), ["--version"], {
        encoding: "utf8",
      }).trim(),
      systemFetch: sawSystemFetch,
    })}`,
  );
});
