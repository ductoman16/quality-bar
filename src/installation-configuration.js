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
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "InstallationConfigurationError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new InstallationConfigurationError(code, message, { cause });
}

/**
 * @param {(path: string, encoding?: BufferEncoding) => string | Buffer} readFile
 * @param {string} path
 * @param {BufferEncoding | undefined} encoding
 * @param {string} missingCode
 * @param {string} missingMessage
 */
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
    fail(missingCode, missingMessage, error);
  }
}

/** @param {string} source */
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

/** @param {unknown} value */
function parseExternalOrigin(value) {
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

/** @param {unknown} value */
function parseTrustedProxyAddresses(value) {
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

/**
 * @param {URL} origin
 * @param {string[]} trustedProxyAddresses
 */
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

/** @param {string | Buffer} source */
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

/**
 * @param {{
 *   configPath?: string,
 *   masterKeyPath?: string,
 *   readFile?: (path: string, encoding?: BufferEncoding) => string | Buffer
 * }} [options]
 */
export function loadInstallationConfiguration({
  configPath = CONFIGURATION_PATH,
  masterKeyPath = MASTER_KEY_PATH,
  readFile = readFileSync,
} = {}) {
  const source = /** @type {string} */ (
    readRequiredFile(
      readFile,
      configPath,
      "utf8",
      "configuration_missing",
      "Configuration source is unavailable",
    )
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

/** @param {Buffer} masterKey */
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

/**
 * @param {string} value
 * @param {Buffer} masterKey
 */
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

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {Buffer} masterKey
 */
export function verifyInstallationKey(durableCore, masterKey) {
  const row = /** @type {{ value: string } | undefined} */ (
    durableCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      INSTALLATION_KEY_VERIFIER_METADATA_KEY,
    )
  );
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
 *
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {Buffer} masterKey
 */
export function verifyRestoredInstallationKey(durableCore, masterKey) {
  const row = /** @type {{ value: string } | undefined} */ (
    durableCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      INSTALLATION_KEY_VERIFIER_METADATA_KEY,
    )
  );
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
