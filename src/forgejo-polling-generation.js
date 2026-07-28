/** @param {unknown} value */
export function readForgejoPollingGeneration(value) {
  if (value === null) {
    return 0;
  }
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new TypeError("Forgejo polling generation is invalid");
  }
  return Number(value);
}
