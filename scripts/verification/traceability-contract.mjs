export const QUALITY_BAR_CANONICAL_REFERENCES = Object.freeze([
  Object.freeze({
    id: "#25",
    role: "specification",
    url: "https://github.com/ductoman16/quality-bar/issues/25",
  }),
  Object.freeze({
    id: "#21#issuecomment-5072366039",
    role: "resolution",
    url: "https://github.com/ductoman16/quality-bar/issues/21#issuecomment-5072366039",
  }),
  Object.freeze({
    id: "#22#issuecomment-5072725791",
    role: "resolution",
    url: "https://github.com/ductoman16/quality-bar/issues/22#issuecomment-5072725791",
  }),
]);

export const QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES = Object.freeze([
  Object.freeze({
    gate: "operator-browser-smoke",
    testGroup: "authenticated-firefox-browser-cross-process",
  }),
  Object.freeze({
    gate: "package-integration",
    testGroup: "compose-service",
  }),
]);

export const QUALITY_BAR_EXPECTED_PROOF_REGISTRATIONS = Object.freeze({
  "adapter-integration": { type: "gate", names: ["adapter-integration"] },
  "browser-component": { type: "gate", names: ["browser-component"] },
  "evidence-manifest": {
    type: "runner",
    entrypoint: "scripts/verification/verification-runner.mjs",
    token: "./manifest-reporting.mjs",
  },
  "fake-codex-integration": {
    type: "gate",
    names: ["fake-codex-integration"],
  },
  "forgejo-fixture-integration": {
    type: "gate",
    names: ["forgejo-fixture-integration"],
  },
  "forgejo-v16-integration": {
    type: "gate",
    names: ["forgejo-v16-integration"],
  },
  "git-integration": { type: "gate", names: ["git-integration"] },
  "github-fixture-integration": {
    type: "gate",
    names: ["github-fixture-integration"],
  },
  "http-integration": { type: "gate", names: ["http-integration"] },
  "http-openapi-integration": {
    type: "gate",
    names: ["openapi-runtime-conformance"],
  },
  "mcp-integration": { type: "gate", names: ["mcp-integration"] },
  "operator-browser-smoke": {
    type: "gate",
    names: ["operator-browser-smoke"],
  },
  "package-integration": { type: "gate", names: ["package-integration"] },
  "packaged-api-mcp-smoke": {
    type: "gate",
    names: ["package-integration"],
  },
  "paid-codex-canary": {
    type: "script",
    script: "canary:paid-codex",
    path: "scripts/verification/run-paid-codex-canary.mjs",
  },
  "private-github-canary": {
    type: "script",
    script: "canary:private-github",
    path: "scripts/verification/run-private-github-canary.mjs",
  },
  "process-integration": { type: "gate", names: ["process-integration"] },
  "security-integration": {
    type: "gate",
    names: ["security-integration"],
  },
  "sqlite-failure-integration": {
    type: "gate",
    names: ["sqlite-failure-integration"],
  },
  "sqlite-integration": { type: "gate", names: ["sqlite-integration"] },
  unit: { type: "gate", names: ["unit"] },
  "verification-gate": {
    type: "runner",
    entrypoint: "scripts/verification/harness.mjs",
    token: "./verification-runner.mjs",
  },
});
