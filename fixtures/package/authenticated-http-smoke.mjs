import { readFile } from "node:fs/promises";

const [port, mode] = process.argv.slice(2);
const password = await readFile("/dev/stdin", "utf8");
const headers = {
  forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
};
const endpoint = `http://127.0.0.1:${port}`;
const login = await fetch(`${endpoint}/api/v1/session/login`, {
  body: JSON.stringify({ password }),
  headers: { ...headers, "content-type": "application/json" },
  method: "POST",
});
const setCookie = login.headers.get("set-cookie");
if (!setCookie) {
  throw new Error("package_probe_login_cookie_missing");
}
const sessionCookie = setCookie.match(
  /quality_bar_session=[A-Za-z0-9_-]{43}/,
)?.[0];
const csrfToken = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
if (!sessionCookie || !csrfToken) {
  throw new Error("package_probe_session_authority_missing");
}
const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;
const browser = await fetch(`${endpoint}/?view=system`, {
  headers: { ...headers, cookie },
});
const browserHtml = await browser.text();
const browserAssetPath = browserHtml.match(/<script[^>]+src="([^"]+)"/)?.[1];
const browserAsset = browserAssetPath
  ? await fetch(new URL(browserAssetPath, endpoint), {
      headers: { ...headers, cookie },
    })
  : null;
const browserJavaScript = browserAsset?.ok ? await browserAsset.text() : "";
const system = await fetch(`${endpoint}/api/v1/system`, {
  headers: { ...headers, cookie },
});
const openapi = await fetch(`${endpoint}/api/v1/openapi.json`, {
  headers: { ...headers, cookie },
});
const systemFacts =
  /** @type {{codex: {catalog: {codex_cli_version: string, models: unknown[]}}, storage: unknown}} */ (
    await system.json()
  );
const codexCapabilityCatalog = systemFacts.codex.catalog;
let machineFacts = {};
if (mode === "machine") {
  const tokenResponse = await fetch(`${endpoint}/api/v1/implementer-token`, {
    body: JSON.stringify({ password }),
    headers: {
      ...headers,
      "content-type": "application/json",
      cookie,
      origin: "https://quality-bar.example",
      "x-quality-bar-csrf": csrfToken,
    },
    method: "POST",
  });
  const implementerToken = /** @type {{token?: string}} */ (
    await tokenResponse.json()
  ).token;
  if (typeof implementerToken !== "string") {
    throw new Error("package_probe_implementer_token_missing");
  }
  const machineHeaders = {
    ...headers,
    authorization: `Bearer ${implementerToken}`,
  };
  const repositoryList = await fetch(`${endpoint}/api/v1/repositories`, {
    headers: machineHeaders,
  });
  const repositoryDocument = /** @type {{items?: unknown[]}} */ (
    await repositoryList.json()
  );
  const mcp = await fetch(`${endpoint}/mcp/v1`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {},
        name: "quality_bar.list_repositories",
      },
    }),
    headers: {
      ...machineHeaders,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    method: "POST",
  });
  const mcpDocument =
    /** @type {{result?: {structuredContent?: {items?: unknown[]}}}} */ (
      await mcp.json()
    );
  machineFacts = {
    mcpRepositoryCount: mcpDocument.result?.structuredContent?.items?.length,
    mcpStatus: mcp.status,
    mcpTool: "quality_bar.list_repositories",
    repositoryCount: repositoryDocument.items?.length,
    repositoryListStatus: repositoryList.status,
    tokenStatus: tokenResponse.status,
  };
  const revokeToken = await fetch(
    `${endpoint}/api/v1/implementer-token/revoke`,
    {
      body: JSON.stringify({ password }),
      headers: {
        ...headers,
        "content-type": "application/json",
        cookie,
        origin: "https://quality-bar.example",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  if (revokeToken.status !== 204) {
    throw new Error(
      `package_probe_implementer_token_revoke_${revokeToken.status}`,
    );
  }
}

console.log(
  JSON.stringify({
    browserStatus: browser.status,
    codexCapabilityCatalogVersion: codexCapabilityCatalog.codex_cli_version,
    hasCodexCapabilityModels:
      Array.isArray(codexCapabilityCatalog.models) &&
      codexCapabilityCatalog.models.length > 0,
    hasNavigation:
      browserHtml.includes('id="app"') &&
      ["Evaluations", "Reviews", "Repositories", "Analytics", "System"].every(
        (label) => browserJavaScript.includes(label),
      ),
    loginStatus: login.status,
    ...machineFacts,
    openapiStatus: openapi.status,
    openapiVersion: /** @type {{openapi: string}} */ (await openapi.json())
      .openapi,
    storage: systemFacts.storage,
  }),
);
