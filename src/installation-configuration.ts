import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

export const CONFIGURATION_PATH = "/etc/quality-bar/config.env";
export const MASTER_KEY_PATH = "/run/secrets/quality-bar-master-key";
export const DEFAULT_FREE_SPACE_RESERVE_BYTES = 5 * 1024 ** 3;

const REQUIRED_CONFIGURATION_KEYS = new Set([
  "QUALITY_BAR_EXTERNAL_ORIGIN",
  "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES",
]);
const OPTIONAL_CONFIGURATION_KEYS = new Set([
  "QUALITY_BAR_FREE_SPACE_RESERVE_BYTES",
]);
const INSTALLATION_KEY_VERIFIER = "quality-bar-installation-key-v1";
const INSTALLATION_KEY_VERIFIER_METADATA_KEY = "installation_key_verifier";

export class InstallationConfigurationError extends Error {
  name: "InstallationConfigurationError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InstallationConfigurationError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new InstallationConfigurationError(code, message, { cause });
}

function readRequiredFile(
  readFile: (path: string, encoding?: BufferEncoding) => string | Buffer,
  path: string,
  encoding: BufferEncoding | undefined,
  missingCode: string,
  missingMessage: string,
) {
  try {
    return readFile(path, encoding);
  } catch (error) {
    fail(missingCode, missingMessage, error);
  }
}

function parseConfiguration(source: string) {
  const entries = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      fail("configuration_malformed", "Configuration has a malformed entry");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value.length === 0) {
      fail("configuration_malformed", "Configuration has a malformed entry");
    }
    if (entries.has(key)) {
      fail("configuration_duplicate", "Configuration has a duplicate key");
    }
    if (
      !REQUIRED_CONFIGURATION_KEYS.has(key) &&
      !OPTIONAL_CONFIGURATION_KEYS.has(key)
    ) {
      fail("configuration_unknown", "Configuration has an unknown key");
    }
    entries.set(key, value);
  }

  for (const key of REQUIRED_CONFIGURATION_KEYS) {
    if (!entries.has(key)) {
      fail(
        "configuration_missing",
        "Configuration is missing a required value",
      );
    }
  }
  return entries;
}

function parseFreeSpaceReserve(value: string | undefined) {
  if (value === undefined) {
    return DEFAULT_FREE_SPACE_RESERVE_BYTES;
  }
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  ) {
    fail(
      "configuration_malformed",
      "Configuration has a malformed free-space reserve",
    );
  }
  return Number(value);
}

function parseExternalOrigin(value: unknown) {
  if (typeof value !== "string") {
    fail(
      "configuration_malformed",
      "Configuration has a malformed external origin",
    );
  }
  let origin = new URL("http://quality-bar.invalid");
  try {
    origin = new URL(value);
  } catch {
    fail(
      "configuration_malformed",
      "Configuration has a malformed external origin",
    );
  }
  if (
    origin.origin !== value ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    fail(
      "configuration_malformed",
      "Configuration has a malformed external origin",
    );
  }
  return origin;
}

function parseTrustedProxyAddresses(value: unknown) {
  if (typeof value !== "string") {
    fail(
      "configuration_malformed",
      "Configuration has malformed trusted proxy addresses",
    );
  }
  if (value === "none") {
    return [];
  }
  const addresses = value.split(",");
  if (
    addresses.length === 0 ||
    addresses.some((address) => address.length === 0 || isIP(address) === 0)
  ) {
    fail(
      "configuration_malformed",
      "Configuration has malformed trusted proxy addresses",
    );
  }
  return addresses;
}

function validateNetworkConfiguration(
  origin: URL,
  trustedProxyAddresses: string[],
) {
  const isLoopbackHttp =
    origin.protocol === "http:" && origin.hostname === "127.0.0.1";
  const hasUnreachableTrustedProxy = trustedProxyAddresses.some(
    (address) => address !== "127.0.0.1",
  );
  if (
    (origin.protocol === "https:" && trustedProxyAddresses.length === 0) ||
    hasUnreachableTrustedProxy ||
    (isLoopbackHttp && trustedProxyAddresses.length > 0) ||
    (origin.protocol === "http:" && !isLoopbackHttp)
  ) {
    fail(
      "configuration_contradictory",
      "Configuration has contradictory external-origin and proxy settings",
    );
  }
}

function parseMasterKey(source: string | Buffer) {
  const encodedKey = source.toString("utf8").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    fail("master_key_malformed", "Installation master key is malformed");
  }
  const masterKey = Buffer.from(encodedKey, "base64");
  if (masterKey.length !== 32 || masterKey.toString("base64") !== encodedKey) {
    fail("master_key_malformed", "Installation master key is malformed");
  }
  return masterKey;
}

export function loadInstallationConfiguration({
  configPath = CONFIGURATION_PATH,
  masterKeyPath = MASTER_KEY_PATH,
  readFile = readFileSync,
}: {
  configPath?: string;
  masterKeyPath?: string;
  readFile?: (path: string, encoding?: BufferEncoding) => string | Buffer;
} = {}) {
  const source = readRequiredFile(
    readFile,
    configPath,
    "utf8",
    "configuration_missing",
    "Configuration source is unavailable",
  ) as string;
  const entries = parseConfiguration(source);
  const origin = parseExternalOrigin(
    entries.get("QUALITY_BAR_EXTERNAL_ORIGIN"),
  );
  const trustedProxyAddresses = parseTrustedProxyAddresses(
    entries.get("QUALITY_BAR_TRUSTED_PROXY_ADDRESSES"),
  );
  const freeSpaceReserveBytes = parseFreeSpaceReserve(
    entries.get("QUALITY_BAR_FREE_SPACE_RESERVE_BYTES"),
  );
  validateNetworkConfiguration(origin, trustedProxyAddresses);
  const masterKey = parseMasterKey(
    readRequiredFile(
      readFile,
      masterKeyPath,
      undefined,
      "master_key_missing",
      "Installation master key is unavailable",
    ),
  );

  return {
    externalOrigin: origin.origin,
    freeSpaceReserveBytes,
    masterKey,
    trustedProxyAddresses,
  };
}

function encryptVerifier(masterKey: Buffer) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(INSTALLATION_KEY_VERIFIER, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    initializationVector.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

function decryptVerifier(value: string, masterKey: Buffer) {
  const [
    version,
    initializationVector,
    authenticationTag,
    ciphertext,
    ...extra
  ] = value.split(".");
  if (
    version !== "v1" ||
    extra.length !== 0 ||
    !initializationVector ||
    !authenticationTag ||
    !ciphertext
  ) {
    return false;
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      masterKey,
      Buffer.from(initializationVector, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authenticationTag, "base64"));
    return (
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8") === INSTALLATION_KEY_VERIFIER
    );
  } catch {
    return false;
  }
}

export function verifyInstallationKey(
  durableCore: ReturnType<
    typeof import("./durable/durable-core.ts").openDurableCore
  >,
  masterKey: Buffer,
) {
  const row = durableCore.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    INSTALLATION_KEY_VERIFIER_METADATA_KEY,
  ) as { value: string } | undefined;
  const storedVerifier = row?.value;
  if (storedVerifier === undefined) {
    durableCore.transaction((transaction) => {
      transaction.run(
        "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
        INSTALLATION_KEY_VERIFIER_METADATA_KEY,
        encryptVerifier(masterKey),
      );
    });
    return;
  }
  if (!decryptVerifier(storedVerifier, masterKey)) {
    fail(
      "master_key_undecryptable",
      "Installation master key cannot decrypt existing encrypted state",
    );
  }
}

/**
 * Restore must authenticate an existing verifier rather than initializing one.
 */
export function verifyRestoredInstallationKey(
  durableCore: ReturnType<
    typeof import("./durable/durable-core.ts").openDurableCore
  >,
  masterKey: Buffer,
) {
  const row = durableCore.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    INSTALLATION_KEY_VERIFIER_METADATA_KEY,
  ) as { value: string } | undefined;
  if (
    typeof row?.value !== "string" ||
    !decryptVerifier(row.value, masterKey)
  ) {
    fail(
      "master_key_undecryptable",
      "Installation master key cannot decrypt restored encrypted state",
    );
  }
}
