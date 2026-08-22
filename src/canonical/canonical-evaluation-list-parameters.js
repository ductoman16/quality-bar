export const EVALUATION_LIST_PARAMETERS = [
  {
    in: "query",
    name: "cursor",
    schema: { minLength: 1, type: "string" },
  },
  {
    in: "query",
    name: "limit",
    schema: { maximum: 100, minimum: 1, type: "integer" },
  },
  {
    in: "query",
    name: "repository_id",
    schema: { minLength: 1, type: "string" },
  },
  {
    in: "query",
    name: "execution_status",
    schema: {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      type: "string",
    },
  },
  {
    in: "query",
    name: "effective_outcome",
    schema: {
      enum: ["pending", "clear", "advisory", "blocking", "error"],
      type: "string",
    },
  },
  { in: "query", name: "start", schema: { minimum: 0, type: "integer" } },
  { in: "query", name: "end", schema: { minimum: 0, type: "integer" } },
  {
    in: "query",
    name: "query",
    schema: { maxLength: 200, minLength: 1, type: "string" },
  },
];
