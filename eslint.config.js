import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import globals from "globals";

import { GENERATED_ARTIFACT_ALLOWLIST } from "./scripts/structural-lint-policy.mjs";

const errorOnlyThrowing = {
  rules: {
    "error-only-throwing": {
      meta: {
        messages: {
          errorOnly: "Thrown values must be Error instances.",
        },
        schema: [],
        type: "problem",
      },
      create(context) {
        function isErrorConstructor(node) {
          return (
            node.type === "NewExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name.endsWith("Error")
          );
        }

        function variableFor(node) {
          let scope = context.sourceCode.getScope(node);
          while (scope) {
            const variable = scope.variables.find(
              (candidate) => candidate.name === node.name,
            );
            if (variable) {
              return variable;
            }
            scope = scope.upper;
          }
          return undefined;
        }

        function isKnownNonError(node, checkedVariables = new Set()) {
          if (
            node.type === "ArrayExpression" ||
            node.type === "Literal" ||
            node.type === "ObjectExpression" ||
            node.type === "TemplateLiteral" ||
            (node.type === "Identifier" && node.name === "undefined")
          ) {
            return true;
          }
          if (node.type === "NewExpression") {
            return !isErrorConstructor(node);
          }
          if (node.type !== "Identifier") {
            return false;
          }
          const variable = variableFor(node);
          if (checkedVariables.has(variable)) {
            return false;
          }
          checkedVariables.add(variable);
          const definition = variable?.defs[0];
          return (
            definition?.type === "Variable" &&
            definition.node.init !== null &&
            isKnownNonError(definition.node.init, checkedVariables)
          );
        }

        return {
          ThrowStatement(node) {
            if (isKnownNonError(node.argument)) {
              context.report({ messageId: "errorOnly", node: node.argument });
            }
          },
        };
      },
    },
  },
};

export default [
  globalIgnores(GENERATED_ARTIFACT_ALLOWLIST, "generated-artifacts"),
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { "error-only-throwing": errorOnlyThrowing },
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
