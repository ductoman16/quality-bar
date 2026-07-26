export function validatePackageFacts(facts, applicationVersion) {
  const requirements = [
    [
      facts && typeof facts === "object" && !Array.isArray(facts),
      "must be an object",
    ],
    [facts?.serviceCount === 1, "serviceCount must equal 1"],
    [facts?.companionServiceCount === 0, "companionServiceCount must equal 0"],
    [facts?.network?.mode === "host", "network.mode must equal host"],
    [
      facts?.network?.httpBindAddress === "127.0.0.1",
      "network.httpBindAddress must equal 127.0.0.1",
    ],
    [facts?.platform === "linux/amd64", "platform must equal linux/amd64"],
    [
      facts?.image === `quality-bar:${applicationVersion}`,
      "image must match the application version",
    ],
    [
      facts?.applicationProcess?.uid === 10001,
      "applicationProcess.uid must equal 10001",
    ],
    [
      facts?.applicationProcess?.pid === 1,
      "applicationProcess.pid must equal 1",
    ],
    [
      facts?.applicationProcess?.executable === "node",
      "applicationProcess.executable must equal node",
    ],
    [
      facts?.applicationProcess?.entrypoint === "src/main.js",
      "applicationProcess.entrypoint must equal src/main.js",
    ],
    [facts?.liveness?.path === "/health/live", "liveness.path is invalid"],
    [facts?.liveness?.httpStatus === 200, "liveness.httpStatus must equal 200"],
    [
      facts?.liveness?.response?.status === "live",
      "liveness.response.status must equal live",
    ],
    [facts?.readiness?.path === "/health/ready", "readiness.path is invalid"],
    [
      facts?.readiness?.httpStatus === 200,
      "readiness.httpStatus must equal 200",
    ],
    [
      facts?.readiness?.response?.status === "ready",
      "readiness.response.status must equal ready",
    ],
    [
      facts?.storage?.databasePath ===
        "/var/lib/quality-bar/quality-bar.sqlite3",
      "storage.databasePath is invalid",
    ],
    [
      facts?.storage?.volumeTarget === "/var/lib/quality-bar",
      "storage.volumeTarget is invalid",
    ],
    [
      facts?.storage?.persistedAcrossRecreate === true,
      "storage.persistedAcrossRecreate must equal true",
    ],
    [
      facts?.storage?.checkoutsPath === "/var/cache/quality-bar/checkouts",
      "storage.checkoutsPath is invalid",
    ],
    [
      facts?.storage?.backupsPath === "/var/backups/quality-bar",
      "storage.backupsPath is invalid",
    ],
    [facts?.storage?.ownedPaths === true, "storage.ownedPaths must equal true"],
    [
      facts?.storage?.localFilesystems === true,
      "storage.localFilesystems must equal true",
    ],
    [
      facts?.installation?.freeSpaceReserveBytes === 5 * 1024 ** 3,
      "installation.freeSpaceReserveBytes is invalid",
    ],
    [
      facts?.installation?.freeSpaceReserveMet === true,
      "installation.freeSpaceReserveMet must equal true",
    ],
    [facts?.tools?.git === "2.54.0", "tools.git must equal 2.54.0"],
    [facts?.tools?.codex === "0.145.0", "tools.codex must equal 0.145.0"],
    [
      facts?.tools?.persistentCodexLogin === false,
      "tools.persistentCodexLogin must equal false for the unprovisioned packaged fixture",
    ],
    [
      facts?.configuration?.configPath === "/etc/quality-bar/config.env",
      "configuration.configPath is invalid",
    ],
    [
      facts?.configuration?.masterKeyPath ===
        "/run/secrets/quality-bar-master-key",
      "configuration.masterKeyPath is invalid",
    ],
    [
      facts?.configuration?.encryptedVerifier === true,
      "configuration.encryptedVerifier must equal true",
    ],
    [
      facts?.authority?.operatorPasswordBootstrap === true,
      "authority.operatorPasswordBootstrap must equal true",
    ],
    [
      facts?.authenticatedHttpSmoke?.browserStatus === 200 &&
        typeof facts?.authenticatedHttpSmoke?.codexCapabilityCatalogVersion ===
          "string" &&
        facts.authenticatedHttpSmoke.codexCapabilityCatalogVersion.length > 0 &&
        facts?.authenticatedHttpSmoke?.hasCodexCapabilityModels === true &&
        facts?.authenticatedHttpSmoke?.hasNavigation === true &&
        facts?.authenticatedHttpSmoke?.loginStatus === 204 &&
        facts?.authenticatedHttpSmoke?.openapiStatus === 200 &&
        facts?.authenticatedHttpSmoke?.openapiVersion === "3.1.0",
      "authenticatedHttpSmoke must prove the packaged authenticated HTTP, OpenAPI, and Codex capability catalog contract",
    ],
    [
      /^\d+\.\d+\.\d+$/.test(facts?.database?.databaseVersion),
      "database.databaseVersion must be semantic",
    ],
    [
      facts?.database?.foreignKeys === true,
      "database.foreignKeys must equal true",
    ],
    [facts?.database?.integrity === "ok", "database.integrity must equal ok"],
    [
      facts?.database?.journalMode === "wal",
      "database.journalMode must equal wal",
    ],
    [
      facts?.database?.schemaVersion === 6,
      "database.schemaVersion must equal 6",
    ],
    [
      facts?.database?.synchronous === "full",
      "database.synchronous must equal full",
    ],
  ];

  return requirements.find(([valid]) => !valid)?.[1] ?? null;
}
