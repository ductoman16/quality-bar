import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";

import { createApplication } from "../src/application/application.ts";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";
import { availableStorageReserve } from "./storage-reserve-support.ts";

export type Application = ReturnType<typeof createApplication>;

export type ReadyApplication = Application & {
  durableCore: NonNullable<Application["durableCore"]>;
  implementerTokens: NonNullable<Application["implementerTokens"]>;
};
const applications: Application[] = [];
const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-http-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function temporaryBackupsPath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-http-backups-"));
  temporaryDirectories.push(directory);
  return directory;
}

export async function startApplication(
  options: {
    applicationVersion?: string;
    backupsPath?: string;
    createRepositories?: Parameters<
      typeof createApplication
    >[0]["createRepositories"];
    createGitHubConnections?: Parameters<
      typeof createApplication
    >[0]["createGitHubConnections"];
    createForgejoConnections?: Parameters<
      typeof createApplication
    >[0]["createForgejoConnections"];
    createRepositoryGuidance?: Parameters<
      typeof createApplication
    >[0]["createRepositoryGuidance"];
    createReviews?: Parameters<typeof createApplication>[0]["createReviews"];
    createStorageReserve?: Parameters<
      typeof createApplication
    >[0]["createStorageReserve"];
    createEvaluations?: Parameters<
      typeof createApplication
    >[0]["createEvaluations"];
    createCodexRuntime?: Parameters<
      typeof createApplication
    >[0]["createCodexRuntime"];
    validateCodexAuthentication?: Parameters<
      typeof createApplication
    >[0]["validateCodexAuthentication"];
    now?: Parameters<typeof createApplication>[0]["now"];
    writeLog?: Parameters<typeof createApplication>[0]["writeLog"];
  } = {},
) {
  const application = createApplication({
    applicationVersion: options.applicationVersion ?? "1.2.3",
    backupsPath: options.backupsPath ?? temporaryBackupsPath(),
    databasePath: temporaryDatabasePath(),
    loadInstallation: () => ({
      externalOrigin: "http://127.0.0.1:3000",
      freeSpaceReserveBytes: 5 * 1024 ** 3,
      masterKey: Buffer.alloc(32, 7),
      trustedProxyAddresses: [],
    }),
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    validateCodexAuthentication:
      options.validateCodexAuthentication ?? (() => {}),
    createRepositories: options.createRepositories,
    createGitHubConnections: options.createGitHubConnections,
    createForgejoConnections: options.createForgejoConnections,
    createRepositoryGuidance: options.createRepositoryGuidance,
    createReviews: options.createReviews,
    createStorageReserve:
      options.createStorageReserve ?? (() => availableStorageReserve),
    createEvaluations: options.createEvaluations,
    createCodexRuntime:
      options.createCodexRuntime ??
      (() => ({
        async close() {},
        start() {},
      })),
    now: options.now,
    writeLog: options.writeLog ?? (() => {}),
  });
  if (!application.durableCore || !application.implementerTokens) {
    throw new Error("http_application_not_ready");
  }
  const readyApplication = application as ReadyApplication;
  bootstrapOperatorPassword(
    readyApplication.durableCore,
    "a correct operator password",
  );
  await readyApplication.server.listen({ host: "127.0.0.1", port: 0 });
  const address = readyApplication.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("http_server_address_unavailable");
  }
  applications.push(readyApplication);
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit) =>
    fetch(new URL(path, origin), init);
  const invalidRequest = (path: string, init?: RequestInit) =>
    request(path, init);
  request.invalidRequest = invalidRequest;
  return {
    application: readyApplication,
    origin,
    request,
  };
}

export async function responseErrorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

export function sessionCookies(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  const session = setCookie?.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )?.[0];
  const csrf = setCookie?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  if (!session || !csrf) {
    throw new Error("http_session_cookies_missing");
  }
  return { csrf, session };
}

export async function authenticatedOperatorHeaders(
  request: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  return {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    await application.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});
