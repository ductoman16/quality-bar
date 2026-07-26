import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import globals from "globals";

import { GENERATED_ARTIFACT_ALLOWLIST } from "./scripts/structural-lint-policy.mjs";

export default [
  globalIgnores(GENERATED_ARTIFACT_ALLOWLIST, "generated-artifacts"),
  js.configs.recommended,
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
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-implicit-coercion": "error",
      "no-throw-literal": "error",
      "no-unused-vars": [
        "error",
        {
          args: "all",
          caughtErrors: "all",
          ignoreRestSiblings: false,
        },
      ],
      "object-shorthand": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["src/**/*.js"],
    ignores: ["src/browser/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/browser/**/*.js", "fixtures/operator-browser-login.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["test/**/*.{js,mjs}", "fixtures/**/*.{js,mjs}"],
    ignores: ["fixtures/operator-browser-login.js"],
    languageOptions: { globals: globals.node },
  },
];
