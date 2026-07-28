/**
 * @typedef {{
 *   serviceCount?: number,
 *   companionServiceCount?: number,
 *   network?: {mode?: string, httpBindAddress?: string},
 *   platform?: string,
 *   image?: string,
 *   applicationProcess?: {
 *     uid?: number,
 *     pid?: number,
 *     executable?: string,
 *     entrypoint?: string,
 *   },
 *   liveness?: {path?: string, httpStatus?: number, response?: {status?: string}},
 *   readiness?: {path?: string, httpStatus?: number, response?: {status?: string}},
 *   storage?: {
 *     databasePath?: string,
 *     volumeTarget?: string,
 *     persistedAcrossRecreate?: boolean,
 *     checkoutsPath?: string,
 *     backupsPath?: string,
 *     ownedPaths?: boolean,
 *     localFilesystems?: boolean,
 *   },
 *   installation?: {
 *     freeSpaceReserveBytes?: number,
 *     freeSpaceReserveMet?: boolean,
 *   },
 *   tools?: {git?: string, codex?: string, persistentCodexLogin?: boolean},
 *   configuration?: {
 *     configPath?: string,
 *     masterKeyPath?: string,
 *     encryptedVerifier?: boolean,
 *   },
 *   authority?: {operatorPasswordBootstrap?: boolean},
 *   authenticatedHttpSmoke?: {
 *     browserStatus?: number,
 *     codexCapabilityCatalogVersion?: string,
 *     hasCodexCapabilityModels?: boolean,
 *     hasNavigation?: boolean,
 *     loginStatus?: number,
 *     openapiStatus?: number,
 *     openapiVersion?: string,
 *   },
 *   database?: {
 *     databaseVersion?: string,
 *     foreignKeys?: boolean,
 *     integrity?: string,
 *     journalMode?: string,
 *     schemaVersion?: number,
 *     synchronous?: string,
 *   },
 *   backup?: {
 *     applicationVersion?: string,
 *     count?: number,
 *     integrity?: string,
 *     keyIdentity?: string,
 *     kind?: string,
 *     masterKeyCopied?: boolean,
 *     schemaVersion?: number,
 *   },
 * }} PackageFacts
 */

/** @param {unknown} facts @param {string | null} applicationVersion */
export function validatePackageFacts(facts, applicationVersion) {
  const packageFacts =
    facts && typeof facts === "object"
      ? /** @type {PackageFacts} */ (facts)
      : null;
  /** @type {[boolean, string][]} */
  const requirements = [
    [packageFacts !== null && !Array.isArray(facts), "must be an object"],
    [packageFacts?.serviceCount === 1, "serviceCount must equal 1"],
    [
      packageFacts?.companionServiceCount === 0,
      "companionServiceCount must equal 0",
    ],
    [packageFacts?.network?.mode === "host", "network.mode must equal host"],
    [
      packageFacts?.network?.httpBindAddress === "127.0.0.1",
      "network.httpBindAddress must equal 127.0.0.1",
    ],
    [
      packageFacts?.platform === "linux/amd64",
      "platform must equal linux/amd64",
    ],
    [
      packageFacts?.image === `quality-bar:${applicationVersion}`,
      "image must match the application version",
    ],
    [
      packageFacts?.applicationProcess?.uid === 10001,
      "applicationProcess.uid must equal 10001",
    ],
    [
      packageFacts?.applicationProcess?.pid === 1,
      "applicationProcess.pid must equal 1",
    ],
    [
      packageFacts?.applicationProcess?.executable === "node",
      "applicationProcess.executable must equal node",
    ],
    [
      packageFacts?.applicationProcess?.entrypoint === "src/main.js",
      "applicationProcess.entrypoint must equal src/main.js",
    ],
    [
      packageFacts?.liveness?.path === "/health/live",
      "liveness.path is invalid",
    ],
    [
      packageFacts?.liveness?.httpStatus === 200,
      "liveness.httpStatus must equal 200",
    ],
    [
      packageFacts?.liveness?.response?.status === "live",
      "liveness.response.status must equal live",
    ],
    [
      packageFacts?.readiness?.path === "/health/ready",
      "readiness.path is invalid",
    ],
    [
      packageFacts?.readiness?.httpStatus === 200,
      "readiness.httpStatus must equal 200",
    ],
    [
      packageFacts?.readiness?.response?.status === "ready",
      "readiness.response.status must equal ready",
    ],
    [
      packageFacts?.storage?.databasePath ===
        "/var/lib/quality-bar/quality-bar.sqlite3",
      "storage.databasePath is invalid",
    ],
    [
      packageFacts?.storage?.volumeTarget === "/var/lib/quality-bar",
      "storage.volumeTarget is invalid",
    ],
    [
      packageFacts?.storage?.persistedAcrossRecreate === true,
      "storage.persistedAcrossRecreate must equal true",
    ],
    [
      packageFacts?.storage?.checkoutsPath ===
        "/var/cache/quality-bar/checkouts",
      "storage.checkoutsPath is invalid",
    ],
    [
      packageFacts?.storage?.backupsPath === "/var/backups/quality-bar",
      "storage.backupsPath is invalid",
    ],
    [
      packageFacts?.storage?.ownedPaths === true,
      "storage.ownedPaths must equal true",
    ],
    [
      packageFacts?.storage?.localFilesystems === true,
      "storage.localFilesystems must equal true",
    ],
    [
      packageFacts?.installation?.freeSpaceReserveBytes === 5 * 1024 ** 3,
      "installation.freeSpaceReserveBytes is invalid",
    ],
    [
      packageFacts?.installation?.freeSpaceReserveMet === true,
      "installation.freeSpaceReserveMet must equal true",
    ],
    [packageFacts?.tools?.git === "2.54.0", "tools.git must equal 2.54.0"],
    [
      packageFacts?.tools?.codex === "0.145.0",
      "tools.codex must equal 0.145.0",
    ],
    [
      packageFacts?.tools?.persistentCodexLogin === false,
      "tools.persistentCodexLogin must equal false for the unprovisioned packaged fixture",
    ],
    [
      packageFacts?.configuration?.configPath === "/etc/quality-bar/config.env",
      "configuration.configPath is invalid",
    ],
    [
      packageFacts?.configuration?.masterKeyPath ===
        "/run/secrets/quality-bar-master-key",
      "configuration.masterKeyPath is invalid",
    ],
    [
      packageFacts?.configuration?.encryptedVerifier === true,
      "configuration.encryptedVerifier must equal true",
    ],
    [
      packageFacts?.authority?.operatorPasswordBootstrap === true,
      "authority.operatorPasswordBootstrap must equal true",
    ],
    [
      packageFacts?.authenticatedHttpSmoke?.browserStatus === 200 &&
        typeof packageFacts?.authenticatedHttpSmoke
          ?.codexCapabilityCatalogVersion === "string" &&
        packageFacts.authenticatedHttpSmoke.codexCapabilityCatalogVersion
          .length > 0 &&
        packageFacts?.authenticatedHttpSmoke?.hasCodexCapabilityModels ===
          true &&
        packageFacts?.authenticatedHttpSmoke?.hasNavigation === true &&
        packageFacts?.authenticatedHttpSmoke?.loginStatus === 204 &&
        packageFacts?.authenticatedHttpSmoke?.openapiStatus === 200 &&
        packageFacts?.authenticatedHttpSmoke?.openapiVersion === "3.1.0",
      "authenticatedHttpSmoke must prove the packaged authenticated HTTP, OpenAPI, and Codex capability catalog contract",
    ],
    [
      typeof packageFacts?.database?.databaseVersion === "string" &&
        /^\d+\.\d+\.\d+$/.test(packageFacts.database.databaseVersion),
      "database.databaseVersion must be semantic",
    ],
    [
      packageFacts?.database?.foreignKeys === true,
      "database.foreignKeys must equal true",
    ],
    [
      packageFacts?.database?.integrity === "ok",
      "database.integrity must equal ok",
    ],
    [
      packageFacts?.database?.journalMode === "wal",
      "database.journalMode must equal wal",
    ],
    [
      packageFacts?.database?.schemaVersion === SCHEMA_VERSION,
      `database.schemaVersion must equal ${SCHEMA_VERSION}`,
    ],
    [
      packageFacts?.database?.synchronous === "full",
      "database.synchronous must equal full",
    ],
    [
      packageFacts?.backup?.applicationVersion === applicationVersion,
      "backup.applicationVersion must match the application version",
    ],
    [packageFacts?.backup?.count === 1, "backup.count must equal 1"],
    [
      packageFacts?.backup?.integrity === "ok",
      "backup.integrity must equal ok",
    ],
    [
      typeof packageFacts?.backup?.keyIdentity === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(packageFacts.backup.keyIdentity),
      "backup.keyIdentity must be a SHA-256 digest",
    ],
    [packageFacts?.backup?.kind === "daily", "backup.kind must equal daily"],
    [
      packageFacts?.backup?.masterKeyCopied === false,
      "backup.masterKeyCopied must equal false",
    ],
    [
      packageFacts?.backup?.schemaVersion === SCHEMA_VERSION,
      `backup.schemaVersion must equal ${SCHEMA_VERSION}`,
    ],
  ];

  return requirements.find(([valid]) => !valid)?.[1] ?? null;
}
import { SCHEMA_VERSION } from "../../src/durable-schema.js";
