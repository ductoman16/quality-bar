export const errorConstructors = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

export const nonErrorCallables = new Set([
  "BigInt",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "parseFloat",
  "parseInt",
]);

export const nonErrorConstructors = new Set([
  "BigInt",
  "Boolean",
  "Number",
  "Object",
  "String",
  "Symbol",
]);

export function parentOf(node: import("estree").Node) {
  return (node as { parent?: import("estree").Node }).parent;
}

export function rangeStart(node: import("estree").Node) {
  if (!node.range) {
    throw new Error("error_only_throwing_ast_range_missing");
  }
  return node.range[0];
}
