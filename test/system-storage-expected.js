import { installationKeyIdentity } from "../src/sqlite-backup.js";

export const expectedSystemApplication = {
  application_version: "1.2.3",
  error: null,
  installation_key_identity: installationKeyIdentity(Buffer.alloc(32, 7)),
  schema_version: 53,
  status: "available",
};

export const expectedSystemBackup = {
  error: null,
  last_successful: null,
  status: "empty",
};

/** @param {{database_version: string}} durableCore */
export function expectedSystemDurableCore(durableCore) {
  return {
    database_version: durableCore.database_version,
    foreign_keys: true,
    integrity: "ok",
    journal_mode: "wal",
    schema_version: 53,
    status: "ready",
    synchronous: "full",
  };
}
