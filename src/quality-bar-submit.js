import { readFileSync } from "node:fs";
import { connect } from "node:net";

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const socketPath = process.env.QUALITY_BAR_SUBMIT_SOCKET;
const token = process.env.QUALITY_BAR_SUBMIT_TOKEN;
if (
  typeof socketPath !== "string" ||
  socketPath.length === 0 ||
  typeof token !== "string" ||
  token.length === 0 ||
  process.argv.length !== 2
) {
  fail(
    "submission_channel_unavailable: Review Run submission channel is unavailable",
  );
} else {
  /** @type {unknown} */
  let candidate;
  try {
    candidate = JSON.parse(readFileSync(0, { encoding: "utf8" }));
  } catch {
    fail(
      "review_run_submission_invalid: Review Run submission is not valid JSON",
    );
  }
  if (candidate !== undefined) {
    await new Promise((resolve) => {
      const socket = connect(socketPath);
      let response = "";
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        socket.end(`${JSON.stringify({ candidate, token })}\n`);
      });
      socket.on("data", (chunk) => {
        response += chunk;
      });
      socket.once("error", () => {
        fail(
          "submission_channel_unavailable: Review Run submission channel is unavailable",
        );
        resolve(undefined);
      });
      socket.once("end", () => {
        try {
          const result = JSON.parse(response);
          if (result.ok !== true) {
            fail(`${result.error.code}: ${result.error.message}`);
          }
        } catch {
          fail(
            "submission_channel_unavailable: Review Run submission response is invalid",
          );
        }
        resolve(undefined);
      });
    });
  }
}
