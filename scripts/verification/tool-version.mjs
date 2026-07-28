/** @param {string | null} version @param {string} tool */
export function requireExactToolVersion(version, tool) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `verification metadata must include an exact ${tool} version`,
    );
  }
  return version;
}
