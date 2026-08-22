import { restoreOfflineBackupFromHost } from "./offline/offline-restore-host.js";

const manifestPath = process.argv[2];
if (process.argv.length !== 3 || !manifestPath) {
  process.stderr.write('{"error":"restore_manifest_argument_invalid"}\n');
  process.exitCode = 1;
} else {
  try {
    const result = await restoreOfflineBackupFromHost({
      applicationVersion: process.env.QUALITY_BAR_VERSION,
      manifestPath,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      process.stderr.write(
        `${JSON.stringify({
          error: error.code,
          ...("retainedPath" in error && typeof error.retainedPath === "string"
            ? { retained_path: error.retainedPath }
            : {}),
        })}\n`,
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
