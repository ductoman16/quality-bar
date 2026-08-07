import { deleteStoppedInstallation } from "./installation-deletion.js";

try {
  const result = deleteStoppedInstallation();
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
        ...("path" in error && typeof error.path === "string"
          ? { path: error.path }
          : {}),
      })}\n`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}
