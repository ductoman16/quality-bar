import { readFile } from "node:fs/promises";

const [port] = process.argv.slice(2);
const password = (await readFile("/dev/stdin", "utf8")).replace(/\r?\n$/, "");
const forwarded = "for=203.0.113.24;host=quality-bar.example;proto=https";
const endpoint = `http://127.0.0.1:${port}`;
const login = await fetch(`${endpoint}/api/v1/session/login`, {
  body: JSON.stringify({ password }),
  headers: { "content-type": "application/json", forwarded },
  method: "POST",
});
if (login.status !== 204) {
  throw new Error(`package_authority_recovery_login_${login.status}`);
}
const setCookie = login.headers.get("set-cookie");
const csrfToken = setCookie?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
if (!setCookie || !csrfToken) {
  throw new Error("package_authority_recovery_cookie_missing");
}
const sessionCookie = setCookie.match(
  /quality_bar_session=[A-Za-z0-9_-]{43}/,
)?.[0];
if (!sessionCookie) {
  throw new Error("package_authority_recovery_session_missing");
}
const token = await fetch(`${endpoint}/api/v1/implementer-token`, {
  body: JSON.stringify({ password }),
  headers: {
    "content-type": "application/json",
    cookie: `${sessionCookie}; quality_bar_csrf=${csrfToken}`,
    forwarded,
    origin: "https://quality-bar.example",
    "x-quality-bar-csrf": csrfToken,
  },
  method: "POST",
});
if (token.status !== 201) {
  throw new Error(`package_authority_recovery_token_${token.status}`);
}
const failedLogin = await fetch(`${endpoint}/api/v1/session/login`, {
  body: JSON.stringify({ password: "an incorrect operator password" }),
  headers: { "content-type": "application/json", forwarded },
  method: "POST",
});
if (failedLogin.status !== 401) {
  throw new Error(
    `package_authority_recovery_failed_login_${failedLogin.status}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    failedLoginStatus: failedLogin.status,
    loginStatus: login.status,
    tokenStatus: token.status,
  })}\n`,
);
