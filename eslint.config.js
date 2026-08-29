import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { globalIgnores } from "eslint/config";
import n from "eslint-plugin-n";
import globals from "globals";

import { errorOnlyThrowing } from "./scripts/error-only-throwing-lint.mts";
import { GENERATED_ARTIFACT_ALLOWLIST } from "./scripts/structural-lint-policy.mts";

export default [
  globalIgnores(GENERATED_ARTIFACT_ALLOWLIST, "generated-artifacts"),
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { "error-only-throwing": errorOnlyThrowing, n },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "max-lines": [
        "error",
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-implicit-coercion": "error",
      "no-throw-literal": "error",
      "error-only-throwing/error-only-throwing": "error",
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
      "n/no-extraneous-import": "error",
      "n/no-missing-import": "error",
      "n/no-unsupported-features/node-builtins": [
        "error",
        {
          ignores: ["import.meta.main", "module.stripTypeScriptTypes", "sqlite"],
          version: "24.18.0",
        },
      ],
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        {
          message: "Use console output only in an approved protocol or proof owner.",
          name: "console",
        },
        {
          message: "Do not bypass console or environment ownership through global.",
          name: "global",
        },
        {
          message:
            "Do not bypass console or environment ownership through globalThis.",
          name: "globalThis",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          message:
            "Read environment through an approved entrypoint, health check, verification owner, or owning test.",
          selector: "MemberExpression[property.name='env']",
        },
        {
          message:
            "Read environment through an approved entrypoint, health check, verification owner, or owning test.",
          selector: "MemberExpression[computed=true][property.value='env']",
        },
        {
          message:
            "Read environment through an approved entrypoint, health check, verification owner, or owning test.",
          selector: "ObjectPattern > Property[key.name='env']",
        },
        {
          message:
            "Read environment through an approved entrypoint, health check, verification owner, or owning test.",
          selector: "ObjectPattern > Property[key.value='env']",
        },
        {
          message:
            "Computed destructuring cannot prove that it avoids environment access.",
          selector: "ObjectPattern > Property[computed=true]",
        },
        {
          message:
            "Do not use a fallback accessor to read environment outside its approved owner.",
          selector:
            "CallExpression[callee.object.name='Reflect'][callee.property.name='get'][arguments.0.name='process'][arguments.1.value='env']",
        },
        {
          message:
            "Do not use a fallback accessor to read environment outside its approved owner.",
          selector:
            "CallExpression[callee.object.name='Reflect'][callee.computed=true][callee.property.value='get'][arguments.0.name='process'][arguments.1.value='env']",
        },
        {
          message:
            "Do not use a fallback accessor to read environment outside its approved owner.",
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name='getOwnPropertyDescriptor'][arguments.0.name='process'][arguments.1.value='env']",
        },
        {
          message:
            "Do not use a fallback accessor to read environment outside its approved owner.",
          selector:
            "CallExpression[callee.object.name='Object'][callee.computed=true][callee.property.value='getOwnPropertyDescriptor'][arguments.0.name='process'][arguments.1.value='env']",
        },
      ],
    },
  },
  {
    files: [
      "fixtures/package/authenticated-http-smoke.mjs",
      "fixtures/package/backup-facts.mjs",
      "fixtures/package/database-facts.mjs",
      "fixtures/package/filesystem-facts.mjs",
      "fixtures/package/http-facts.mjs",
      "scripts/package-proof/prove-compose-service.mts",
      "test/operator-browser-smoke.test.ts",
    ],
    rules: { "no-console": "off", "no-restricted-globals": "off" },
  },
  {
    files: [
      "scripts/package-proof/package-fixture.mts",
      "scripts/release-canary/run-paid-codex.mts",
      "scripts/release-canary/run-private-github.mts",
      "src/healthcheck.ts",
      "src/main.ts",
      "src/operator/operator-password-bootstrap.ts",
      "src/quality-bar-submit.ts",
      "src/recover-operator-authority.ts",
      "src/review/review-run-codex-adapter.ts",
      "src/restore-backup.ts",
      "fixtures/test-probes/fake-codex-review-run.mjs",
      "test/operator-browser-smoke.test.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["src/**/*.{js,mjs,ts,mts}"],
    ignores: ["src/browser/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "src/browser/**/*.{js,ts}",
      "ui/**/*.{js,ts}",
      "fixtures/operator-browser-login.js",
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.{mjs,mts}", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["test/**/*.{js,mjs,ts,mts}", "fixtures/**/*.{js,mjs}"],
    ignores: ["fixtures/operator-browser-login.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          caughtErrors: "all",
          ignoreRestSiblings: false,
        },
      ],
    },
  },
];
