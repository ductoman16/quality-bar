import { readFile } from "node:fs/promises";

const [port] = process.argv.slice(2);
const password = await readFile("/dev/stdin", "utf8");
const endpoint = `http://127.0.0.1:${port}`;
const forwarded = {
  forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
};

const login = await fetch(`${endpoint}/api/v1/session/login`, {
  body: JSON.stringify({ password }),
  headers: { ...forwarded, "content-type": "application/json" },
  method: "POST",
});
const setCookie = login.headers.get("set-cookie");
const sessionCookie = setCookie?.match(
  /quality_bar_session=[A-Za-z0-9_-]{43}/,
)?.[0];
const csrfToken = setCookie?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
if (!sessionCookie || !csrfToken) {
  throw new Error("package_probe_session_authority_missing");
}
const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;

const system = await fetch(`${endpoint}/api/v1/system`, {
  headers: { ...forwarded, cookie },
});
const systemFacts = /** @type {{codex?: {catalog?: unknown}}} */ (
  await system.json()
);

console.log(
  JSON.stringify({
    loginStatus: login.status,
    systemStatus: system.status,
    hasSystemCatalog: Boolean(systemFacts.codex?.catalog),
  }),
);
