import { recoverOperatorAuthorityFromHost } from "./operator-authority-recovery.js";

let authorityRecovered = false;
try {
  await recoverOperatorAuthorityFromHost({
    onAuthorityRecovered() {
      authorityRecovered = true;
    },
  });
  process.stdout.write('{"status":"operator_authority_recovered"}\n');
} catch (error) {
  if (authorityRecovered) {
    process.stderr.write(
      '{"cleanup":"failed","status":"operator_authority_recovered"}\n',
    );
    throw error;
  } else if (
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
