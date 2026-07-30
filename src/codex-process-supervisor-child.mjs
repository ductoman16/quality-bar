import { spawn } from "node:child_process";
import process from "node:process";
import { clearInterval, setInterval } from "node:timers";

let launched = false;
let completed = false;
let terminationRequested = false;
const keepAlive = setInterval(() => {}, 60_000);

function stopSupervisor() {
  clearInterval(keepAlive);
  process.exitCode = 0;
  if (process.connected) {
    process.disconnect();
  }
}

process.on("SIGTERM", () => {
  terminationRequested = true;
  if (completed) {
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
  if (!launched) {
    clearInterval(keepAlive);
    process.exitCode = 1;
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
    message.environment === null
  ) {
    send({
      message: "Codex supervisor launch request is invalid",
      type: "launch-error",
    });
    return;
  }
  launched = true;
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
    send({ code, signal, type: "result" });
    if (terminationRequested) {
      stopSupervisor();
    }
  });
});
