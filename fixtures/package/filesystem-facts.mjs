import { lstatSync, statfsSync } from "node:fs";

const paths = [
  "/var/lib/quality-bar",
  "/var/lib/quality-bar/codex-home",
  "/var/cache/quality-bar/checkouts",
  "/var/backups/quality-bar",
  "/etc/quality-bar/config.env",
  "/run/secrets/quality-bar-master-key",
];
const localFilesystemTypes = new Set([
  0xef53, 0x58465342, 0x794c7630, 0x9123683e, 0x2fc12fc1,
]);
const localFilesystemPaths = [
  "/var/lib/quality-bar",
  "/var/cache/quality-bar/checkouts",
  "/var/backups/quality-bar",
];
const pathFacts = Object.fromEntries(
  paths.map((path) => {
    const status = lstatSync(path);
    return [
      path,
      {
        filesystemType: statfsSync(path).type,
        gid: status.gid,
        mode: status.mode & 0o777,
        uid: status.uid,
      },
    ];
  }),
);

console.log(
  JSON.stringify({
    localFilesystems: localFilesystemPaths.every((path) =>
      localFilesystemTypes.has(statfsSync(path).type),
    ),
    pathFacts,
    stateFreeBytes:
      statfsSync("/var/lib/quality-bar").bavail *
      statfsSync("/var/lib/quality-bar").bsize,
    checkoutsFreeBytes:
      statfsSync("/var/cache/quality-bar/checkouts").bavail *
      statfsSync("/var/cache/quality-bar/checkouts").bsize,
  }),
);
