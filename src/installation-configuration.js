import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

export const CONFIGURATION_PATH = "/etc/quality-bar/config.env";
export const MASTER_KEY_PATH = "/run/secrets/quality-bar-master-key";

const REQUIRED_CONFIGURATION_KEYS = new Set([
  "QUALITY_BAR_EXTERNAL_ORIGIN",
  "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES",
]);
const INSTALLATION_KEY_VERIFIER = "quality-bar-installation-key-v1";
const INSTALLATION_KEY_VERIFIER_METADATA_KEY = "installation_key_verifier";

export class InstallationConfigurationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "InstallationConfigurationError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new InstallationConfigurationError(code, message, { cause });
}

function readRequiredFile(
  readFile,
  path,
  encoding,
  missingCode,
  missingMessage,
) {
  try {
    return readFile(path, encoding);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(missingCode, missingMessage, error);
    }
    fail(missingCode, missingMessage, error);
  }
}

function parseConfiguration(source) {
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
    if (!REQUIRED_CONFIGURATION_KEYS.has(key)) {
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

function parseExternalOrigin(value) {
  let origin;
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

function parseTrustedProxyAddresses(value) {
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

function validateNetworkConfiguration(origin, trustedProxyAddresses) {
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

function parseMasterKey(source) {
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
} = {}) {
  const source = readRequiredFile(
    readFile,
    configPath,
    "utf8",
    "configuration_missing",
    "Configuration source is unavailable",
  );
  const entries = parseConfiguration(source);
  const origin = parseExternalOrigin(
    entries.get("QUALITY_BAR_EXTERNAL_ORIGIN"),
  );
  const trustedProxyAddresses = parseTrustedProxyAddresses(
    entries.get("QUALITY_BAR_TRUSTED_PROXY_ADDRESSES"),
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
    masterKey,
    trustedProxyAddresses,
  };
}

function encryptVerifier(masterKey) {
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

function decryptVerifier(value, masterKey) {
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

export function verifyInstallationKey(durableCore, masterKey) {
  const storedVerifier = durableCore.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    INSTALLATION_KEY_VERIFIER_METADATA_KEY,
  )?.value;
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
