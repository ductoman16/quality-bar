import { validateOperatorBrowserFacts } from "./gate-facts.mjs";

export const OPERATOR_BROWSER_SMOKE_GATE = Object.freeze({
  name: "operator-browser-smoke",
  testGroup: "authenticated-firefox-browser-cross-process",
  failureCode: "operator_browser_smoke_failed",
  factsMarker: "QUALITY_BAR_OPERATOR_BROWSER_FACTS",
  validateFacts: validateOperatorBrowserFacts,
  arguments: ["--test", "test/operator-browser-smoke.test.js"],
});
