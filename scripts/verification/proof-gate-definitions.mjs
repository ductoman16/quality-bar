export const NODE_OWNERSHIP_LINT_PROOF_GATE = {
  name: "node-ownership-lint-proof",
  testGroup: "maintained-javascript-node-and-ownership-boundaries",
  failureCode: "node_ownership_lint_proof_failed",
  arguments: ["--test", "test/node-boundary-lint-gate.test.js"],
};
