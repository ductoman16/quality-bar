import { readFile } from "node:fs/promises";

const [port] = process.argv.slice(2);
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
const cookie = setCookie.split(";", 1)[0];
const browser = await fetch(`${endpoint}/?view=system`, {
  headers: { ...headers, cookie },
});
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

console.log(
  JSON.stringify({
    browserStatus: browser.status,
    codexCapabilityCatalogVersion: codexCapabilityCatalog.codex_cli_version,
    hasCodexCapabilityModels:
      Array.isArray(codexCapabilityCatalog.models) &&
      codexCapabilityCatalog.models.length > 0,
    hasNavigation: /Evaluations.*Reviews.*Repositories.*Analytics.*System/.test(
      await browser.text(),
    ),
    loginStatus: login.status,
    openapiStatus: openapi.status,
    openapiVersion: /** @type {{openapi: string}} */ (await openapi.json())
      .openapi,
    storage: systemFacts.storage,
  }),
);
