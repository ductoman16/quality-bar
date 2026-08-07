import assert from "node:assert/strict";

/**
 * @param {{
 *   localFilesystems: boolean,
 *   stateFreeBytes: number,
 *   checkoutsFreeBytes: number,
 *   pathFacts: Record<string, {gid: number, mode: number, uid: number}>,
 * }} filesystemFacts
 */
export function assertFilesystemFacts(filesystemFacts) {
  assert.equal(filesystemFacts.localFilesystems, true);
  assert.ok(filesystemFacts.stateFreeBytes >= 5 * 1024 ** 3);
  assert.ok(filesystemFacts.checkoutsFreeBytes >= 5 * 1024 ** 3);
  for (const [path, facts] of Object.entries(filesystemFacts.pathFacts)) {
    assert.deepEqual(facts, {
      gid: 10001,
      mode:
        path === "/etc/quality-bar/config.env" ||
        path === "/run/secrets/quality-bar-master-key"
          ? 0o400
          : 0o700,
      uid: 10001,
    });
  }
}
