import { DatabaseSync } from "node:sqlite";

import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../../src/sqlite-backup.js";

const [applicationVersion, encodedMasterKey] = process.argv.slice(2);
if (!applicationVersion || !encodedMasterKey) {
  throw new Error("package_restore_snapshot_arguments_missing");
}
const database = new DatabaseSync("/var/lib/quality-bar/quality-bar.sqlite3");
try {
  database.exec(`
    INSERT INTO github_connections (
      singleton_key, id, app_id, app_slug, installation_id, principal_id,
      principal_login, api_profile, permissions, capabilities,
      repository_count, lifecycle, created_at, verified_at
    ) VALUES (
      1, 'package-restored-github', 1, 'quality-bar', 2, 3, 'operator',
      'github-rest:2026-03-10', '{}', '{}', 1, 'retired', 1, 1
    );
    INSERT INTO forgejo_connections (
      id, base_url, api_profile, reported_version, principal_id,
      principal_login, scopes, capabilities, health, lifecycle, created_at,
      verified_at
    ) VALUES (
      'package-restored-forgejo', 'https://forgejo.example',
      'forgejo-v16', '16.0.1', 5, 'operator', '[]', '{}', 'healthy',
      'retired', 1, 1
    );
    INSERT INTO github_repository_polls (
      connection_id, forge_repository_id, baseline_status, last_success_at,
      next_attempt_at, snapshot
    ) VALUES ('package-restored-github', 4, 'complete', 1, 2, '[]');
    INSERT INTO forgejo_repository_polls (
      connection_id, forge_repository_id, baseline_status, last_success_at,
      next_attempt_at, snapshot
    ) VALUES ('package-restored-forgejo', 6, 'complete', 1, 2, '[]');
  `);
  const backup = await createValidatedBackup({
    applicationVersion,
    backupsPath: "/var/backups/quality-bar",
    database,
    keyIdentity: installationKeyIdentity(
      Buffer.from(encodedMasterKey, "base64"),
    ),
    kind: "daily",
    now: () => Date.parse("2026-07-29T00:00:00.000Z"),
  });
  process.stdout.write(
    `${JSON.stringify({ manifestPath: backup.manifestPath })}\n`,
  );
} finally {
  database.close();
}
