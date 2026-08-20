import assert from "node:assert/strict";

/**
 * @param {{
 *   localFilesystems: boolean,
 *   stateFreeBytes: number,
 *   checkoutsFreeBytes: number,
 *   pathFacts: Record<string, {filesystemType: number, gid: number, mode: number, uid: number}>,
 * }} filesystemFacts
 */
export function assertFilesystemFacts(filesystemFacts) {
  assert.equal(filesystemFacts.localFilesystems, true);
  assert.ok(filesystemFacts.stateFreeBytes >= 5 * 1024 ** 3);
  assert.ok(filesystemFacts.checkoutsFreeBytes >= 5 * 1024 ** 3);
  for (const [path, facts] of Object.entries(filesystemFacts.pathFacts)) {
    const readOnlySource =
      path === "/etc/quality-bar/config.env" ||
      path === "/run/secrets/quality-bar-master-key";
    assert.equal(facts.mode, readOnlySource ? 0o400 : 0o700);
    assert.equal(
      (facts.uid === 10001 && facts.gid === 10001) ||
        (readOnlySource &&
          facts.uid === 0 &&
          facts.gid === 0 &&
          facts.filesystemType === 0x65735546),
      true,
    );
  }
}
