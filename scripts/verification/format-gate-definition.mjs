/** @param {{node: string, prettier: string}} tools */
export function formattingGateDefinition(tools) {
  return {
    name: "formatting",
    failureCode: "formatting_failed",
    command: "npm",
    arguments: ["run", "format:check"],
    checkGroups: [{ name: "repository-format", count: 1, unit: "repository" }],
    tools,
  };
}
