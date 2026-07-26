import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  InstallationConfigurationError,
  loadInstallationConfiguration,
  verifyInstallationKey,
} from "../src/installation-configuration.js";
import { openDurableCore } from "../src/durable-core.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories = [];
const configurationPath = "/etc/quality-bar/config.env";
const masterKeyPath = "/run/secrets/quality-bar-master-key";
const validConfiguration = [
  "QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000",
  "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
].join("\n");
const validMasterKey = Buffer.alloc(32, 7).toString("base64");

function load(input = {}) {
  const configuration = input.configuration ?? validConfiguration;
  const masterKey = Object.hasOwn(input, "masterKey")
    ? input.masterKey
    : validMasterKey;
  return loadInstallationConfiguration({
    configPath: configurationPath,
    masterKeyPath,
    readFile(path, encoding) {
      if (path === configurationPath) {
        return encoding ? configuration : Buffer.from(configuration);
      }
      if (path === masterKeyPath) {
        if (masterKey === undefined) {
          const error = new Error("not found");
          error.code = "ENOENT";
          throw error;
        }
        return encoding ? masterKey : Buffer.from(masterKey);
      }
      throw new Error(`unexpected path ${path}`);
    },
  });
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-configuration-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("loads the one complete configuration source and external installation key", () => {
  const installation = load();

  assert.equal(installation.externalOrigin, "http://127.0.0.1:3000");
  assert.deepEqual(installation.trustedProxyAddresses, []);
  assert.equal(installation.masterKey.equals(Buffer.alloc(32, 7)), true);
});

for (const [name, input, code] of [
  [
    "a missing required configuration value",
    "QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000",
    "configuration_missing",
  ],
  [
    "a duplicate configuration value",
    `${validConfiguration}\nQUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000`,
    "configuration_duplicate",
  ],
  [
    "an unknown configuration value",
    `${validConfiguration}\nQUALITY_BAR_UNUSED=value`,
    "configuration_unknown",
  ],
  [
    "a malformed external origin",
    "QUALITY_BAR_EXTERNAL_ORIGIN=not-a-url\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
    "configuration_malformed",
  ],
  [
    "a non-loopback HTTP origin",
    "QUALITY_BAR_EXTERNAL_ORIGIN=http://192.168.1.15:3000\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
    "configuration_contradictory",
  ],
  [
    "an HTTP localhost origin",
    "QUALITY_BAR_EXTERNAL_ORIGIN=http://localhost:3000\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
    "configuration_contradictory",
  ],
  [
    "an HTTP IPv6 loopback origin",
    "QUALITY_BAR_EXTERNAL_ORIGIN=http://[::1]:3000\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
    "configuration_contradictory",
  ],
  [
    "contradictory proxy settings",
    "QUALITY_BAR_EXTERNAL_ORIGIN=https://quality-bar.example\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none",
    "configuration_contradictory",
  ],
  [
    "an HTTPS proxy that cannot reach the loopback listener",
    "QUALITY_BAR_EXTERNAL_ORIGIN=https://quality-bar.example\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=192.0.2.10",
    "configuration_contradictory",
  ],
]) {
  test(`rejects ${name} with its owning error without echoing configuration values`, () => {
    assert.throws(
      () => load({ configuration: input }),
      (error) => {
        assert.ok(error instanceof InstallationConfigurationError);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /not-a-url|quality-bar\.example/i);
        return true;
      },
    );
  });
}

test("rejects a missing or malformed master key without exposing its value", () => {
  for (const masterKey of [undefined, "not-a-master-key"]) {
    assert.throws(
      () => load({ masterKey }),
      (error) => {
        assert.ok(error instanceof InstallationConfigurationError);
        assert.equal(
          error.code,
          masterKey === undefined
            ? "master_key_missing"
            : "master_key_malformed",
        );
        assert.doesNotMatch(error.message, /not-a-master-key/);
        return true;
      },
    );
  }
});

test("persists only an encrypted installation-key verifier and rejects an undecryptable existing state", () => {
  const databasePath = temporaryDatabasePath();
  const firstKey = load().masterKey;
  const core = openDurableCore(databasePath);

  verifyInstallationKey(core, firstKey);
  const verifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    "installation_key_verifier",
  ).value;
  assert.doesNotMatch(verifier, new RegExp(firstKey.toString("base64")));
  core.close();

  const reopenedCore = openDurableCore(databasePath);
  assert.throws(
    () => verifyInstallationKey(reopenedCore, Buffer.alloc(32, 8)),
    (error) => {
      assert.equal(error.code, "master_key_undecryptable");
      assert.doesNotMatch(error.message, /CAgICAg/);
      return true;
    },
  );
  assert.equal(
    reopenedCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "installation_key_verifier",
    ).value,
    verifier,
  );
  reopenedCore.close();
});
