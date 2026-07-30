import assert from "node:assert/strict";
import test from "node:test";

import { createWaiverAdjudicationPrompt } from "../src/waiver-adjudication-execution.js";

test("the focused prompt contains only selected immutable waiver context", () => {
  const prompt = createWaiverAdjudicationPrompt({
    baseCommit: "a".repeat(40),
    evaluationId: "evaluation-selected",
    headCommit: "b".repeat(40),
    requests: [
      {
        criterion: {
          id: "criterion-selected",
          impact: "advisory",
          instruction: "Selected accepted standard.",
        },
        finding: {
          evidence: "Selected evidence.",
          id: "finding-selected",
          location: { kind: "changeset" },
          remediation: "Selected remediation.",
        },
        rationale: "Selected exception rationale.",
        requestId: "request-selected",
        reviewVersion: {
          id: "version-selected",
          name: "Selected Review",
          number: 2,
        },
      },
    ],
  });

  for (const selected of [
    "request-selected",
    "evaluation-selected",
    "finding-selected",
    "criterion-selected",
    "version-selected",
    "Selected Review",
    "Selected evidence.",
    "Selected accepted standard.",
    "Selected exception rationale.",
    "quality-bar-submit",
    "Accepted requires convincing frozen evidence",
    "Weak, merely convenient, or uncertain exceptions are denied",
    "Error is only for required permitted evidence that is unavailable or unusable",
  ]) {
    assert.match(
      prompt,
      new RegExp(selected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  for (const excluded of [
    "finding-unselected",
    "later-commit",
    "other-review",
    "unselected discussion text",
    "unselected repository rule",
  ]) {
    assert.doesNotMatch(prompt, new RegExp(excluded, "i"));
  }
});
