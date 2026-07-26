/** @param {unknown} facts */
export function validateOperatorBrowserFacts(facts) {
  if (!facts || typeof facts !== "object") {
    return "must be an object";
  }
  const browserFacts = /** @type {{
   *   engine?: unknown,
   *   authenticatedShell?: unknown,
   *   systemFetch?: unknown,
   *   executableVersion?: unknown,
   * }} */ (facts);
  return browserFacts.engine !== "firefox"
    ? "engine must equal firefox"
    : browserFacts.authenticatedShell !== true
      ? "authenticatedShell must equal true"
      : browserFacts.systemFetch !== true
        ? "systemFetch must equal true"
        : typeof browserFacts.executableVersion !== "string" ||
            browserFacts.executableVersion.length === 0
          ? "executableVersion must be nonempty"
          : null;
}
