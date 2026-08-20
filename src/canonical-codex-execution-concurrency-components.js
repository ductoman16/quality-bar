import { closedObject } from "./canonical-schema.js";

export function canonicalCodexExecutionConcurrencySchemas() {
  return {
    CodexExecutionConcurrency: closedObject(
      {
        maximum_running: { maximum: 4, minimum: 1, type: "integer" },
      },
      ["maximum_running"],
    ),
  };
}
