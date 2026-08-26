import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function publishTrustedProcess(input: {
  binding: { groupId: number; leaderStartIdentity: string };
  directory: string;
  path: string;
  publishFile: Function;
}) {
  const temporaryPath = join(
    input.directory,
    `quality-bar-submit-process.tmp-${randomUUID()}`,
  );
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        client_pid: input.binding.groupId,
        client_process_group_id: input.binding.groupId,
        client_start_identity: input.binding.leaderStartIdentity,
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return input.publishFile(temporaryPath, input.path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
