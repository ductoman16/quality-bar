import { spawn } from "node:child_process";
import process from "node:process";
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from "node:timers";

let launched = false;
let completed = false;
let parentDisconnected = false;
let terminationRequested = false;
let terminateOnParentDisconnect = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let forceTerminationTimer = null;
const keepAlive = setInterval(() => {}, 60_000);

function stopSupervisor() {
  clearInterval(keepAlive);
  clearTimeout(forceTerminationTimer ?? undefined);
  process.exitCode = 0;
  if (process.connected) {
    process.disconnect();
  }
}

function terminateDisconnectedProcessGroup() {
  if (terminationRequested) {
    return;
  }
  terminationRequested = true;
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      stopSupervisor();
      return;
    }
    throw error;
  }
  forceTerminationTimer = setTimeout(() => {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        )
      ) {
        process.exitCode = 1;
      }
    }
  }, 5_000);
}

process.on("SIGTERM", () => {
  terminationRequested = true;
  if (!launched || completed) {
    stopSupervisor();
  }
});

function send(message) {
  if (process.connected) {
    try {
      process.send(message, () => {});
    } catch {
      // The parent may disappear at any point; the identity anchor must remain.
    }
  }
}

process.once("disconnect", () => {
  parentDisconnected = true;
  if (!launched) {
    clearInterval(keepAlive);
    process.exitCode = 1;
  } else if (terminateOnParentDisconnect) {
    terminateDisconnectedProcessGroup();
  }
});

process.on("message", (message) => {
  if (message?.type === "finish") {
    stopSupervisor();
    return;
  }
  if (
    launched ||
    message?.type !== "launch" ||
    typeof message.command !== "string" ||
    !Array.isArray(message.arguments) ||
    typeof message.environment !== "object" ||
    message.environment === null ||
    typeof message.terminateOnParentDisconnect !== "boolean"
  ) {
    send({
      message: "Codex supervisor launch request is invalid",
      type: "launch-error",
    });
    return;
  }
  launched = true;
  terminateOnParentDisconnect = message.terminateOnParentDisconnect;
  let child;
  try {
    child = spawn(message.command, message.arguments, {
      env: message.environment,
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (error) {
    send({
      message: error instanceof Error ? error.message : String(error),
      type: "launch-error",
    });
    return;
  }
  child.once("error", (error) => {
    send({
      message: error instanceof Error ? error.message : String(error),
      type: "launch-error",
    });
  });
  child.once("close", (code, signal) => {
    completed = true;
    clearTimeout(forceTerminationTimer ?? undefined);
    send({ code, signal, type: "result" });
    if (terminationRequested || parentDisconnected) {
      stopSupervisor();
    }
  });
});
