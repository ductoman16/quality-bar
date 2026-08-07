import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { withPaidCodexCanaryLease } from "../scripts/verification/paid-codex-canary-lease.mjs";

test("holds singleton ownership across the complete paid operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const lockPath = join(directory, "paid.lock");
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let firstStarted = false;
  let secondStarted = false;
  try {
    const first = withPaidCodexCanaryLease(lockPath, async () => {
      firstStarted = true;
      await held;
    });
    while (!firstStarted) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      () =>
        withPaidCodexCanaryLease(lockPath, async () => {
          secondStarted = true;
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "paid_codex_canary_lock_unavailable",
    );
    assert.equal(secondStarted, false);
    release();
    await first;
    await withPaidCodexCanaryLease(lockPath, async () => {});
  } finally {
    release();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("normalizes falsy operation failures and releases owned lock state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const lockPath = join(directory, "paid.lock");
  try {
    await assert.rejects(
      () => withPaidCodexCanaryLease(lockPath, async () => Promise.reject()),
      /paid Codex canary operation failed/u,
    );
    await withPaidCodexCanaryLease(lockPath, async () => {});
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("parent replacement retains stale provenance and preserves foreign state", async () => {
  const root = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const directory = join(root, "locks");
  const displaced = join(root, "displaced");
  const lockPath = join(directory, "paid.lock");
  mkdirSync(directory);
  try {
    await assert.rejects(
      () =>
        withPaidCodexCanaryLease(lockPath, async () => {
          renameSync(directory, displaced);
          mkdirSync(directory);
        }),
      /paid Codex canary lock cleanup failed/u,
    );
    assert.equal(existsSync(lockPath), false);
    assert.equal(existsSync(join(displaced, "paid.lock")), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("lease loss fences launch and retains stale and foreign provenance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const lockPath = join(directory, "paid.lock");
  const stalePath = join(directory, "paid.lock.stale");
  let launched = false;
  try {
    await assert.rejects(
      () =>
        withPaidCodexCanaryLease(lockPath, async (assertOwned) => {
          renameSync(lockPath, stalePath);
          writeFileSync(lockPath, "foreign\n", { flag: "wx", mode: 0o600 });
          assertOwned();
          launched = true;
        }),
      (error) =>
        error instanceof AggregateError &&
        error.errors[0]?.message ===
          "paid Codex canary lock identity changed" &&
        /** @type {any} */ (error).code === "paid_codex_canary_lock_lost",
    );
    assert.equal(launched, false);
    assert.equal(existsSync(stalePath), true);
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a moved live lease still fences a second paid operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const lockPath = join(directory, "paid.lock");
  const stalePath = `${lockPath}.stale`;
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let firstStarted = false;
  let secondStarted = false;
  try {
    const first = withPaidCodexCanaryLease(lockPath, async () => {
      firstStarted = true;
      renameSync(lockPath, stalePath);
      await held;
    });
    while (!firstStarted) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      () =>
        withPaidCodexCanaryLease(lockPath, async () => {
          secondStarted = true;
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "paid_codex_canary_lock_unavailable",
    );
    assert.equal(secondStarted, false);
    release();
    await assert.rejects(first, /paid Codex canary lock cleanup failed/u);
    assert.equal(existsSync(stalePath), true);
  } finally {
    release();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("reclaims a proven-stale crashed lease before starting", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-"));
  const lockPath = join(directory, "paid.lock");
  let started = false;
  try {
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        leaseId: "stale-lease",
        pid: process.pid,
        startIdentity: "stale-process",
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await withPaidCodexCanaryLease(lockPath, async () => {
      started = true;
    });
    assert.equal(started, true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed owner-record write never exposes an invalid canonical lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-atomic-"));
  const lockPath = join(directory, "paid.lock");
  const originalWrite = fs.writeFileSync;
  let injected = false;
  try {
    fs.writeFileSync = (...arguments_) => {
      if (!injected && typeof arguments_[0] === "number") {
        injected = true;
        throw new Error("synthetic owner-record interruption");
      }
      return originalWrite(...arguments_);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      () => withPaidCodexCanaryLease(lockPath, async () => {}),
      /synthetic owner-record interruption/u,
    );
    assert.equal(existsSync(lockPath), false);
  } finally {
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
  }
  try {
    await withPaidCodexCanaryLease(lockPath, async () => {});
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a live tracked provider guard fences recovery after runner provenance disappears", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-lease-guard-"));
  const lockPath = join(directory, "paid.lock");
  const provider = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  await once(provider, "spawn");
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let callbackEntered = false;
  let guarded = false;
  let secondStarted = false;
  /** @type {Promise<void> | null} */
  let first = null;
  try {
    first = withPaidCodexCanaryLease(
      lockPath,
      async (_assertOwned, trackProcessGroup) => {
        callbackEntered = true;
        assert.equal(typeof _assertOwned, "function");
        assert.equal(typeof trackProcessGroup, "function");
        trackProcessGroup(/** @type {number} */ (provider.pid));
        rmSync(lockPath, { force: true });
        guarded = true;
        await held;
      },
    );
    while (!callbackEntered) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      () =>
        withPaidCodexCanaryLease(lockPath, async () => {
          secondStarted = true;
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "paid_codex_canary_lock_unavailable",
    );
    assert.equal(guarded, true);
    assert.equal(secondStarted, false);
    release();
    await assert.rejects(first, /paid Codex canary lock cleanup failed/u);
  } finally {
    release();
    await first?.catch(() => {});
    try {
      process.kill(-(/** @type {number} */ (provider.pid)), "SIGKILL");
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        assert.equal(error.code, "ESRCH");
      }
    }
    await once(provider, "close").catch(() => {});
    rmSync(directory, { force: true, recursive: true });
  }
});
