import { restoreOfflineBackup } from "../../src/offline-restore.js";

const [databasePath, manifestPath, masterKeyHex, crashBoundary] =
  process.argv.slice(2);

await restoreOfflineBackup({
  applicationVersion: "0.1.0",
  commitOperations: {
    publicationBoundary(boundary) {
      if (boundary === crashBoundary) {
        process.kill(process.pid, "SIGKILL");
      }
    },
  },
  databasePath,
  manifestPath,
  masterKey: Buffer.from(masterKeyHex, "hex"),
});
