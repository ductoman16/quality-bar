export function validateOperatorBrowserFacts(facts) {
  return facts?.engine !== "firefox"
    ? "engine must equal firefox"
    : facts?.authenticatedShell !== true
      ? "authenticatedShell must equal true"
      : facts?.systemFetch !== true
        ? "systemFetch must equal true"
        : typeof facts?.executableVersion !== "string" ||
            facts.executableVersion.length === 0
          ? "executableVersion must be nonempty"
          : null;
}
