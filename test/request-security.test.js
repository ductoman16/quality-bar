import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RequestSecurityError,
  createRequestSecurityBoundary,
} from "../src/request-security.js";

function request(remoteAddress, headers = {}) {
  return { headers, socket: { remoteAddress } };
}

test("permits plain HTTP only from a loopback peer configured for loopback HTTP", () => {
  const boundary = createRequestSecurityBoundary({
    externalOrigin: "http://127.0.0.1:3000",
    trustedProxyAddresses: [],
  });

  assert.deepEqual(boundary.requestFacts(request("127.0.0.1")), {
    clientAddress: "127.0.0.1",
    host: "127.0.0.1:3000",
    scheme: "http",
  });
  assert.throws(
    () =>
      boundary.requestFacts(
        request("192.168.1.15", {
          forwarded: "for=203.0.113.24;host=attacker.example;proto=https",
        }),
      ),
    (error) =>
      error instanceof RequestSecurityError && error.code === "https_required",
  );
});

test("honors complete forwarded facts only from an explicitly trusted proxy", () => {
  const boundary = createRequestSecurityBoundary({
    externalOrigin: "https://quality-bar.example",
    trustedProxyAddresses: ["127.0.0.1"],
  });
  const forwarded = "for=203.0.113.24;host=quality-bar.example;proto=https";

  assert.deepEqual(boundary.requestFacts(request("127.0.0.1", { forwarded })), {
    clientAddress: "203.0.113.24",
    host: "quality-bar.example",
    scheme: "https",
  });
  assert.throws(
    () => boundary.requestFacts(request("192.168.1.15", { forwarded })),
    (error) =>
      error instanceof RequestSecurityError && error.code === "https_required",
  );
});

test("rejects a trusted proxy with missing, ambiguous, or mismatched forwarded facts", () => {
  const boundary = createRequestSecurityBoundary({
    externalOrigin: "https://quality-bar.example",
    trustedProxyAddresses: ["127.0.0.1"],
  });

  for (const forwarded of [
    undefined,
    "for=203.0.113.24;host=quality-bar.example;proto=https,for=203.0.113.25;host=quality-bar.example;proto=https",
    "for=203.0.113.24;host=attacker.example;proto=https",
    "for=203.0.113.24;host=quality-bar.example;proto=http",
    "for=not-an-address;host=quality-bar.example;proto=https",
  ]) {
    assert.throws(
      () => boundary.requestFacts(request("127.0.0.1", { forwarded })),
      (error) =>
        error instanceof RequestSecurityError &&
        ["proxy_forwarded_required", "proxy_forwarded_invalid"].includes(
          error.code,
        ),
    );
  }
});
