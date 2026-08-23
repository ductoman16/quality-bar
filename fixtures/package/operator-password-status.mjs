import { readFile } from "node:fs/promises";

import { openDurableCore } from "../../src/durable/durable-core.js";
import { verifyOperatorPassword } from "../../src/operator/operator-password.js";

const password = (await readFile("/dev/stdin", "utf8")).replace(/\r?\n$/, "");
const core = openDurableCore("/var/lib/quality-bar/quality-bar.sqlite3");
let authenticated = false;
try {
  verifyOperatorPassword(core, password);
  authenticated = true;
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "authentication_invalid"
  ) {
    throw error;
  }
} finally {
  core.close();
}

process.stdout.write(`${JSON.stringify({ authenticated })}\n`);
