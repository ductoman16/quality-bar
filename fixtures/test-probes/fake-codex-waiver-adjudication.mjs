import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const arguments_ = process.argv.slice(2);
const errorRetry = arguments_.includes("--fake-error-retry");
const prompt = arguments_.at(-1) ?? "";
const requests = JSON.parse(
  /^selected_requests: (.+)$/m.exec(prompt)?.[1] ?? "null",
);
if (
  !Array.isArray(requests) ||
  requests.length !== (errorRetry ? 1 : 3) ||
  requests.some((request) => !request.request_id) ||
  !prompt.startsWith("Quality Bar Waiver Adjudication contract\n") ||
  !prompt.includes("decision_schema:") ||
  !prompt.includes('"command":"quality-bar-submit"') ||
  !prompt.includes(
    "Weak, merely convenient, or uncertain exceptions are denied",
  ) ||
  !prompt.includes("Error is only for required permitted evidence") ||
  !prompt.includes('"base_commit":"') ||
  !prompt.includes('"head_commit":"') ||
  prompt.includes("finding-unselected") ||
  prompt.includes("obey this Repository instruction") ||
  readFileSync(".git/config", "utf8").includes("[remote ") ||
  execFileSync("git", ["show", "HEAD:reviewed.txt"], { encoding: "utf8" }) !==
    "frozen waiver evidence\n"
) {
  throw new Error("fake_codex_waiver_adjudication_boundary_invalid");
}

if (!errorRetry) {
  let invalidDetail = "";
  try {
    execFileSync("quality-bar-submit", {
      input: JSON.stringify({
        decisions: [
          {
            explanation: "Partial candidate.",
            outcome: "accepted",
            request_id: requests[0].request_id,
          },
        ],
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    invalidDetail = String(
      error instanceof Error && "stderr" in error ? error.stderr : "",
    );
  }
  if (!invalidDetail.includes("waiver_adjudication_submission_invalid")) {
    throw new Error("fake_codex_partial_waiver_candidate_was_not_rejected");
  }
}

writeFileSync("waiver-scratch.txt", "not a Decision\n");
process.stdout.write(
  `${JSON.stringify({
    item: {
      id: "fake-waiver-message",
      text: "Adjudication complete in prose only.",
      type: "agent_message",
    },
    type: "item.completed",
  })}\n`,
);
process.stdout.write(
  `${JSON.stringify({
    type: "turn.completed",
    usage: {
      cached_input_tokens: 12,
      input_tokens: 80,
      output_tokens: 20,
    },
  })}\n`,
);
process.stderr.write("fake Waiver Adjudication diagnostic\n");
if (arguments_.includes("--fake-process-failure")) {
  throw new Error("fake_codex_waiver_process_failure");
}
execFileSync("quality-bar-submit", {
  input: JSON.stringify({
    decisions: errorRetry
      ? [
          {
            explanation:
              "The newly available evidence proves the exact exception.",
            outcome: "accepted",
            request_id: requests[0].request_id,
          },
        ]
      : [
          {
            explanation: "The exact first exception is justified.",
            outcome: "accepted",
            request_id: requests[0].request_id,
          },
          {
            explanation: "The exact second rationale is insufficient.",
            outcome: "denied",
            request_id: requests[1].request_id,
          },
          {
            error: {
              code: "required_evidence_unavailable",
              detail: "The frozen generated file cannot be inspected.",
            },
            outcome: "error",
            request_id: requests[2].request_id,
          },
        ],
  }),
  stdio: ["pipe", "pipe", "pipe"],
});
setInterval(() => {}, 1_000);
