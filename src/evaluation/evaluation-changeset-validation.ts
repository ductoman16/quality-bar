export function requireFrozenChangeset(changeset: any) {
  if (
    changeset?.read_content !== undefined &&
    typeof changeset.read_content !== "function"
  ) {
    throw new TypeError("Frozen Changeset content reader is invalid");
  }
  if (
    !changeset ||
    typeof changeset.base_commit !== "string" ||
    typeof changeset.head_commit !== "string"
  ) {
    throw new TypeError("Frozen Changeset is invalid");
  }
  return changeset;
}
