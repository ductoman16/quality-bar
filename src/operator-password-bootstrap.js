import { readFileSync } from "node:fs";

import { openDurableCore } from "./durable-core.js";
import {
  loadInstallationConfiguration,
  verifyInstallationKey,
} from "./installation-configuration.js";
import {
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";
import {
  OperatorPasswordError,
  bootstrapOperatorPassword,
} from "./operator-password.js";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

function fail(code, message, cause) {
  throw new OperatorPasswordError(code, message, { cause });
}

export function passwordFromStandardInput(source) {
  if (typeof source !== "string") {
    fail("operator_password_input_missing", "Operator password input is required");
  }
  const password = source.endsWith("\r\n")
    ? source.slice(0, -2)
    : source.endsWith("\n")
      ? source.slice(0, -1)
      : source;
  if (password.length === 0) {
    fail("operator_password_input_missing", "Operator password input is required");
  }
  return password;
}

function passwordFromTerminal(input, output) {
  output.write("Operator password: ");
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let password = "";

    function finish(error) {
      input.off("data", receive);
      input.off("end", end);
      input.setRawMode(false);
      if (error) {
        reject(error);
      } else {
        output.write("\n");
        resolve(passwordFromStandardInput(password));
      }
    }

    function receive(characters) {
      for (const character of characters) {
        if (character === "\u0003") {
          finish(
            new OperatorPasswordError(
              "operator_password_input_cancelled",
              "Operator password input was cancelled",
            ),
          );
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f") {
          password = password.slice(0, -1);
          continue;
        }
        password += character;
      }
    }

    function end() {
      finish();
    }

    input.on("data", receive);
    input.once("end", end);
  });
}

export function readOperatorPassword({
  input = process.stdin,
  output = process.stderr,
  readFile = readFileSync,
} = {}) {
  if (input.isTTY) {
    return passwordFromTerminal(input, output);
  }
  try {
    return Promise.resolve(passwordFromStandardInput(readFile(input.fd, "utf8")));
  } catch (error) {
    if (error instanceof OperatorPasswordError) {
      return Promise.reject(error);
    }
    return Promise.reject(
      new OperatorPasswordError(
        "operator_password_input_missing",
        "Operator password input is required",
        { cause: error },
      ),
    );
  }
}

export async function bootstrapOperatorPasswordFromHost({
  databasePath = DATABASE_PATH,
  loadInstallation = loadInstallationConfiguration,
  readPassword = readOperatorPassword,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
} = {}) {
  validateSources();
  const installation = loadInstallation();
  const { releaseInstallationLock } = validateInstallation();
  let durableCore;

  try {
    durableCore = openDurableCore(databasePath);
    verifyInstallationKey(durableCore, installation.masterKey);
    bootstrapOperatorPassword(durableCore, await readPassword());
  } finally {
    durableCore?.close();
    releaseInstallationLock?.();
  }
}
