import { isIP } from "node:net";

export class RequestSecurityError extends Error {
  name: "RequestSecurityError";
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RequestSecurityError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RequestSecurityError(code, message);
}

function isLoopbackAddress(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function forwardedFacts(
  value: string | string[] | undefined,
  expectedHost: string,
) {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "proxy_forwarded_required",
      "Trusted proxy must supply complete Forwarded facts",
    );
  }
  if (value.includes(",")) {
    fail(
      "proxy_forwarded_invalid",
      "Trusted proxy forwarded facts are invalid",
    );
  }

  const facts = new Map();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0 || separator === part.length - 1) {
      fail(
        "proxy_forwarded_invalid",
        "Trusted proxy forwarded facts are invalid",
      );
    }
    const name = part.slice(0, separator).toLowerCase();
    const fact = part.slice(separator + 1);
    if (!/^[a-z]+$/.test(name) || facts.has(name)) {
      fail(
        "proxy_forwarded_invalid",
        "Trusted proxy forwarded facts are invalid",
      );
    }
    facts.set(name, fact);
  }

  const clientAddress = facts.get("for");
  if (
    facts.get("proto") !== "https" ||
    facts.get("host") !== expectedHost ||
    typeof clientAddress !== "string" ||
    isIP(clientAddress) === 0
  ) {
    fail(
      "proxy_forwarded_invalid",
      "Trusted proxy forwarded facts are invalid",
    );
  }
  return clientAddress;
}

export function createRequestSecurityBoundary({
  externalOrigin,
  trustedProxyAddresses,
}: { externalOrigin?: string; trustedProxyAddresses?: string[] } = {}) {
  let origin;
  try {
    origin = new URL(externalOrigin ?? "");
  } catch {
    throw new TypeError("externalOrigin must be a valid URL");
  }
  if (!Array.isArray(trustedProxyAddresses)) {
    throw new TypeError("trustedProxyAddresses must be an array");
  }
  const trustedProxies = new Set(trustedProxyAddresses);

  return {
    requestFacts(request: {
      headers: { forwarded?: string | string[] };
      socket: { remoteAddress?: string };
    }) {
      const peerAddress = request?.socket?.remoteAddress;
      if (typeof peerAddress === "string" && trustedProxies.has(peerAddress)) {
        const clientAddress = forwardedFacts(
          request.headers.forwarded,
          origin.host,
        );
        return { clientAddress, host: origin.host, scheme: "https" };
      }
      if (
        origin.protocol !== "http:" ||
        typeof peerAddress !== "string" ||
        !isLoopbackAddress(peerAddress)
      ) {
        fail("https_required", "HTTPS is required outside loopback");
      }
      return { clientAddress: peerAddress, host: origin.host, scheme: "http" };
    },
  };
}
