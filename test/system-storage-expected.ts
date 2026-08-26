import { installationKeyIdentity } from "../src/sqlite-backup.ts";

export const expectedSystemApplication = {
  application_version: "1.2.3",
  error: null,
  installation_key_identity: installationKeyIdentity(Buffer.alloc(32, 7)),
  status: "available",
};

export const expectedSystemBackup = {
  error: null,
  last_successful: null,
  status: "empty",
};

export function expectedSystemDurableCore(durableCore: {
  database_version: string;
}) {
  return {
    database_version: durableCore.database_version,
    foreign_keys: true,
    integrity: "ok",
    journal_mode: "wal",
    status: "ready",
    synchronous: "full",
  };
}
