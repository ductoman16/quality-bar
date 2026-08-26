import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.ts";
import { processGroupIdentity } from "../src/review/review-run-submission-process-group.ts";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

async function submitWithoutClientInspection(
  channel: Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>,
  checkoutPath: string,
) {
  writeFileSync(join(checkoutPath, ".quality-bar-result.json"), "{}\n");
  return await new Promise((resolve) => {
    execFile(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        '(version 1) (allow default) (deny process-exec (literal "/bin/ps"))',
        join(channel.commandDirectory, "quality-bar-submit"),
        ".quality-bar-result.json",
      ],
      {
        cwd: checkoutPath,
        env: {
          ...channel.environment,
          PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
        },
        timeout: 5_000,
      },
      (...callbackArguments) => {
        const [error, , stderr] = callbackArguments;
        resolve(error ? stderr : "");
      },
    );
  });
}

/**
 * The installed command no longer inspects its own process metadata. Its
 * intrinsic PID is checked by the server against the trusted leader instead.
 */
async function submitDetached(
  channel: Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>,
  checkoutPath: string,
) {
  writeFileSync(join(checkoutPath, ".quality-bar-result.json"), "{}\n");
  return await new Promise((resolve) => {
    const child = spawn(
      join(channel.commandDirectory, "quality-bar-submit"),
      [".quality-bar-result.json"],
      {
        cwd: checkoutPath,
        detached: true,
        env: {
          ...channel.environment,
          PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
        },
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 5_000,
      },
    );
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", () => resolve(stderr));
    child.once("close", (code) => resolve(code === 0 ? "" : stderr));
  });
}

test(
  "accepts an actual group member when the sandbox denies client inspection",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-provenance-"));
    context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
    const channel = await openReviewRunSubmissionChannel(
      claim,
      { prepare() {} },
      { checkoutPath },
    );
    channel.bindProcessGroup(processGroupIdentity(process.pid) as number);
    try {
      assert.equal(
        await submitWithoutClientInspection(channel, checkoutPath),
        "",
      );
      assert.equal(await channel.waitForResult(), "accepted");
    } finally {
      await channel.close();
    }
  },
);

test(
  "rejects a detached submitter without relying on client inspection",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-provenance-"));
    context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
    const trustedGroup = processGroupIdentity(process.pid) as number;
    const inspections: Array<{ group: number | null; pid: number }> = [];
    const channel = await openReviewRunSubmissionChannel(
      claim,
      { prepare() {} },
      {
        checkoutPath,
        isProcessDescendant: () => false,
        processGroupIdentity(pid) {
          const group = processGroupIdentity(pid);
          inspections.push({ group, pid });
          return group;
        },
      },
    );
    channel.bindProcessGroup(trustedGroup);
    try {
      const stderr = await submitDetached(channel, checkoutPath);
      assert.equal(
        inspections.some(
          ({ group, pid }) => pid !== trustedGroup && group !== trustedGroup,
        ),
        true,
      );
      assert.equal(
        stderr,
        "submission_channel_unavailable: Review Run submission channel is unavailable\n",
      );
      assert.equal(await channel.waitForResult(), "failed");
    } finally {
      await channel.close();
    }
  },
);

test(
  "accepts a descendant command started in a sandbox child process group",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-descendant-"));
    context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
    writeFileSync(join(checkoutPath, ".quality-bar-result.json"), "{}\n");
    const channel = await openReviewRunSubmissionChannel(
      claim,
      { prepare() {} },
      { checkoutPath },
    );
    let stderr = "";
    const leader = spawn(
      process.execPath,
      [
        "-e",
        `
          const { spawn } = require("node:child_process");
          process.once("message", () => {
            const child = spawn(process.argv[1], [".quality-bar-result.json"], {
              cwd: process.argv[2],
              detached: true,
              env: process.env,
              stdio: ["ignore", "ignore", "pipe"],
            });
            child.stderr.pipe(process.stderr);
            child.once("close", (code) => process.exit(code ?? 1));
          });
          setTimeout(() => process.exit(2), 5000).unref();
        `,
        join(channel.commandDirectory, "quality-bar-submit"),
        checkoutPath,
      ],
      {
        detached: true,
        env: {
          ...channel.environment,
          PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    leader.stderr?.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    await once(leader, "spawn");
    channel.bindProcessGroup(leader.pid as number);
    leader.send({ type: "start" });
    try {
      assert.equal(await channel.waitForResult(), "accepted");
      const [code] = await once(leader, "close");
      assert.equal(code, 0, stderr);
    } finally {
      await channel.close();
      try {
        process.kill(-(leader.pid as number), "SIGKILL");
      } catch (error) {
        assert.equal(
          error instanceof Error && "code" in error ? error.code : null,
          "ESRCH",
        );
      }
    }
  },
);
