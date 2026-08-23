import { bootstrapOperatorPasswordFromHost } from "./operator/operator-password-bootstrap.js";

try {
  await bootstrapOperatorPasswordFromHost();
  process.stdout.write('{"status":"operator_password_bootstrapped"}\n');
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    process.stderr.write(`${JSON.stringify({ error: error.code })}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
