import { closedObject } from "./canonical-schema.js";

export function canonicalWaiverAdjudicatorConfigurationSchemas() {
  return {
    WaiverAdjudicatorConfigurationState: {
      oneOf: [
        closedObject({ configured: { const: false, type: "boolean" } }, [
          "configured",
        ]),
        closedObject(
          {
            configuration: { $ref: "CodexConfiguration#" },
            configured: { const: true, type: "boolean" },
          },
          ["configured", "configuration"],
        ),
      ],
    },
    WaiverAdjudicatorConfigurationChange: closedObject(
      {
        changed: { type: "boolean" },
        configuration: { $ref: "CodexConfiguration#" },
      },
      ["changed", "configuration"],
    ),
  };
}
