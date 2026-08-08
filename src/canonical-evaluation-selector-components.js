import { closedObject } from "./canonical-schema.js";

export function canonicalEvaluationSelectorSchemas() {
  return {
    EvaluationSelector: {
      oneOf: [
        closedObject(
          {
            type: { const: "branch", type: "string" },
            value: {
              minLength: 1,
              pattern:
                "^(?!@$)(?![./])(?!.*(?:\\.\\.|//|@\\{|[\\u0000-\\u0020\\u007f~^:?*\\[\\\\]))(?!.*(?:^|/)\\.)(?!.*\\.lock(?:/|$))(?!.*[./]$).+$",
              type: "string",
            },
          },
          ["type", "value"],
        ),
        closedObject(
          {
            type: { const: "commit", type: "string" },
            value: {
              pattern: "^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$",
              type: "string",
            },
          },
          ["type", "value"],
        ),
      ],
    },
  };
}
