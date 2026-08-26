export function readForgejoPollingGeneration(value: unknown) {
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
