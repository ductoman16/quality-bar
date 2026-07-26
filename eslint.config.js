import { globalIgnores } from "eslint/config";

import { GENERATED_ARTIFACT_ALLOWLIST } from "./scripts/structural-lint-policy.mjs";

export default [
  globalIgnores(GENERATED_ARTIFACT_ALLOWLIST, "generated-artifacts"),
  {
    files: ["**/*.{js,mjs,cjs}"],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
