import { browserElement } from "./repository-browser-component-support.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);

/** @param {Record<string, unknown>} [overrides] */
export const evaluation = (overrides = {}) => ({
  base_commit: oid("1"),
  base_selector: { type: "branch", value: "main" },
  completed_at: "2026-07-28T12:00:00.000Z",
  created_at: "2026-07-28T12:00:00.000Z",
  effective_outcome: "clear",
  execution_status: "completed",
  head_commit: oid("2"),
  head_selector: { type: "branch", value: "topic" },
  id: "evaluation-complete",
  next_attempt_at: null,
  provenance: "explicit",
  repository: {
    id: "repository-1",
    url: "https://example.invalid/repository.git",
  },
  ...overrides,
});

export function evaluationElements() {
  return /** @type {any} */ (
    new Map(
      [
        "evaluation-create-form",
        "evaluation-repository",
        "evaluation-base-type",
        "evaluation-base-value",
        "evaluation-head-type",
        "evaluation-head-value",
        "evaluation-loading",
        "evaluation-empty",
        "evaluation-state",
        "evaluation-active",
        "evaluation-recent",
        "evaluation-attention",
        "evaluation-more",
        "evaluation-create-status",
      ].map((id) => [id, browserElement({ hidden: true })]),
    )
  );
}
