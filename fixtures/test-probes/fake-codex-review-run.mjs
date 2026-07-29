import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const arguments_ = process.argv.slice(2);
const prompt = arguments_.at(-1) ?? "";
const criterion = /criterion_id: ([^\n]+)/.exec(prompt)?.[1];
if (
  arguments_[0] !== "--ignore-user-config" ||
  !arguments_.includes("exec") ||
  !arguments_.includes("--sandbox") ||
  !arguments_.includes("workspace-write") ||
  typeof criterion !== "string"
) {
  throw new Error("fake_codex_review_run_arguments_invalid");
}
const submitPath = process.env.QUALITY_BAR_SUBMIT_PATH;
if (typeof submitPath !== "string" || submitPath.length === 0) {
  throw new Error("fake_codex_review_run_submission_path_missing");
}
writeFileSync("codex-scratch.txt", "not a Result\n");
process.stdout.write("Review complete in prose only.\n");
let invalidFailure = "";
try {
  execFileSync(process.execPath, [submitPath], {
    encoding: "utf8",
    input: JSON.stringify({ criterion_results: [] }),
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch (error) {
  invalidFailure =
    error instanceof Error &&
    "stderr" in error &&
    (typeof error.stderr === "string" || Buffer.isBuffer(error.stderr))
      ? String(error.stderr)
      : "";
}
if (!invalidFailure.includes("criterion_result_coverage_invalid")) {
  throw new Error("fake_codex_invalid_submission_was_not_rejected");
}
execFileSync(process.execPath, [submitPath], {
  input: JSON.stringify({
    criterion_results: [{ criterion_id: criterion, outcome: "clear" }],
  }),
  stdio: ["pipe", "pipe", "pipe"],
});
