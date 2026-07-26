import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import { dirname, resolve } from "node:path";

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

        function isErrorConstructor(node) {
          if (
            node.type !== "NewExpression" ||
            node.callee.type !== "Identifier"
          ) {
            return false;
          }
          const builtInConstructors = new Set([
            "AggregateError",
            "Error",
            "EvalError",
            "RangeError",
            "ReferenceError",
            "SyntaxError",
            "TypeError",
            "URIError",
          ]);
          const repositoryConstructors = new Map([
            [
              resolve(import.meta.dirname, "src/durable-error.js"),
              new Set(["DurableCoreError"]),
            ],
            [
              resolve(import.meta.dirname, "src/operator-password.js"),
              new Set(["OperatorPasswordError"]),
            ],
            [
              resolve(import.meta.dirname, "src/browser-assets.js"),
              new Set(["BrowserAssetError"]),
            ],
            [
              resolve(import.meta.dirname, "src/browser-session.js"),
              new Set(["BrowserSessionError"]),
            ],
            [
              resolve(import.meta.dirname, "src/codex-capabilities.js"),
              new Set(["CodexConfigurationError"]),
            ],
            [
              resolve(import.meta.dirname, "src/implementer-token.js"),
              new Set(["ImplementerTokenError"]),
            ],
            [
              resolve(import.meta.dirname, "src/installation-configuration.js"),
              new Set(["InstallationConfigurationError"]),
            ],
            [
              resolve(import.meta.dirname, "src/installation-environment.js"),
              new Set(["InstallationEnvironmentError"]),
            ],
            [
              resolve(import.meta.dirname, "src/operator-login-throttle.js"),
              new Set(["OperatorLoginThrottleError"]),
            ],
            [
              resolve(import.meta.dirname, "src/request-security.js"),
              new Set(["RequestSecurityError"]),
            ],
            [
              resolve(import.meta.dirname, "src/review.js"),
              new Set(["ReviewError"]),
            ],
          ]);
          const variable = variableFor(node.callee);
          const definition = variable?.defs[0];
          if (!definition) {
            return builtInConstructors.has(node.callee.name);
          }
          if (definition.type === "ImportBinding") {
            return (
              definition.node.type === "ImportSpecifier" &&
              repositoryConstructors
                .get(
                  resolve(
                    dirname(context.filename),
                    definition.node.parent.source.value,
                  ),
                )
                ?.has(definition.node.imported.name)
            );
          }
          return (
            definition.type === "ClassName" &&
            definition.node.superClass !== null &&
            isErrorConstructor({
              callee: definition.node.superClass,
              type: "NewExpression",
            })
          );
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
            (variable.references.filter((reference) => reference.isWrite())
              .length > 1 ||
              isKnownNonError(definition.node.init, checkedVariables))
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
