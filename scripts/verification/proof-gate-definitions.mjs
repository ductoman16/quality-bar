export const NODE_OWNERSHIP_LINT_PROOF_GATE = {
  name: "node-ownership-lint-proof",
  testGroup: "maintained-javascript-node-and-ownership-boundaries",
  failureCode: "node_ownership_lint_proof_failed",
  arguments: ["--test", "test/node-boundary-lint-gate.test.js"],
};

export const PRODUCTION_TYPE_CHECK_PROOF_GATE = {
  name: "production-type-check-proof",
  testGroup: "production-node-and-served-browser-javascript",
  failureCode: "production_type_check_proof_failed",
  arguments: ["--test", "test/javascript-type-check-gate.test.js"],
};

export const PROOF_CODE_TYPE_CHECK_PROOF_GATE = {
  name: "proof-code-type-check-proof",
  testGroup: "maintained-test-verification-and-proof-javascript",
  failureCode: "proof_code_type_check_proof_failed",
  arguments: ["--test", "test/test-verification-type-check-gate.test.js"],
};
