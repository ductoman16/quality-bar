import { readFileSync } from "node:fs";

import { loadInstallationConfiguration } from "../installation-configuration.ts";
import {
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "../installation-environment.ts";
import { runOperatorPasswordHostMutation } from "./operator-password-host.ts";
import {
  OperatorPasswordError,
  bootstrapOperatorPassword,
} from "./operator-password.ts";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

function fail(code: string, message: string, cause?: unknown): never {
  throw new OperatorPasswordError(code, message, { cause });
}

export function passwordFromStandardInput(source: string) {
  if (typeof source !== "string") {
    fail(
      "operator_password_input_missing",
      "Operator password input is required",
    );
  }
  const password = source.endsWith("\r\n")
    ? source.slice(0, -2)
    : source.endsWith("\n")
      ? source.slice(0, -1)
      : source;
  if (password.length === 0) {
    fail(
      "operator_password_input_missing",
      "Operator password input is required",
    );
  }
  return password;
}

function passwordFromTerminal(
  input: import("node:tty").ReadStream,
  output: NodeJS.WritableStream,
): Promise<string> {
  output.write("Operator password: ");
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let password = "";

    function finish(error?: Error) {
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

    function receive(characters: string) {
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
}: {
  input?:
    | (import("node:tty").ReadStream & { fd: number })
    | {
        fd: number;
        isTTY: false;
      };
  output?: import("node:tty").WriteStream;
  readFile?: (fd: number, encoding: "utf8") => string;
} = {}) {
  if (input.isTTY) {
    return passwordFromTerminal(input, output);
  }
  try {
    return Promise.resolve(
      passwordFromStandardInput(readFile(input.fd, "utf8")),
    );
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
}: {
  databasePath?: string;
  loadInstallation?: () => {
    freeSpaceReserveBytes: number;
    masterKey: Buffer;
  };
  readPassword?: () => string | Promise<string>;
  validateInstallation?: (options: { reserveBytes: number }) => {
    releaseInstallationLock?: () => void;
  };
  validateSources?: () => void;
} = {}) {
  return runOperatorPasswordHostMutation({
    databasePath,
    loadInstallation,
    mutate: bootstrapOperatorPassword,
    readPassword,
    validateInstallation,
    validateSources,
  });
}
