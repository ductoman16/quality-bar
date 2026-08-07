import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review-run-submission-channel.js";
import { publishFile } from "../src/review-run-submission-files.js";
import { processGroupIdentity } from "../src/review-run-submission-process-group.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});
const boundChannels = new WeakSet();

/** @param {{after(callback: () => void): void}} context */
function createCheckout(context) {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-command-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  return checkoutPath;
}

/**
 * @param {Awaited<ReturnType<typeof openReviewRunSubmissionChannel>>} channel
 * @param {string} checkoutPath
 * @param {Record<string, string>} [environment]
 */
async function submit(
  channel,
  checkoutPath,
  environment = channel.environment,
) {
  if (!boundChannels.has(channel)) {
    channel.bindProcessGroup(
      /** @type {number} */ (processGroupIdentity(process.pid)),
    );
    boundChannels.add(channel);
  }
  writeFileSync(join(checkoutPath, ".quality-bar-result.json"), "{}\n");
  return await new Promise((resolve) => {
    execFile(
      "quality-bar-submit",
      [".quality-bar-result.json"],
      {
        cwd: checkoutPath,
        env: {
          ...environment,
          PATH: [
            channel.commandDirectory,
            dirname(process.execPath),
            "/usr/bin",
            "/bin",
          ].join(delimiter),
        },
      },
      (...callbackArguments) => {
        const [error, , stderr] = callbackArguments;
        resolve(error ? stderr : "");
      },
    );
  });
}

test("accepts a submission when the host drops the submission environment", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  try {
    assert.equal(await submit(channel, checkoutPath, {}), "");
    assert.equal(await channel.waitForResult(), "accepted");
  } finally {
    await channel.close();
  }
});

test(
  "exposes the canonical command directory to the sandbox",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const checkoutPath = createCheckout(context);
    const channel = await openReviewRunSubmissionChannel(
      claim,
      { prepare() {} },
      { checkoutPath },
    );
    try {
      assert.equal(
        channel.commandDirectory,
        realpathSync(channel.commandDirectory),
      );
    } finally {
      await channel.close();
    }
  },
);

test("fails fast when installed trusted-process provenance is corrupt", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  try {
    channel.bindProcessGroup(
      /** @type {number} */ (processGroupIdentity(process.pid)),
    );
    boundChannels.add(channel);
    writeFileSync(
      join(channel.commandDirectory, "quality-bar-submit-process"),
      "corrupt\n",
    );
    assert.equal(
      await submit(channel, checkoutPath, {}),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
  } finally {
    await channel.close();
  }
});

test("the generated command executes only with its installed sibling runtime", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const commandPath = join(channel.commandDirectory, "quality-bar-submit");
  const runtimePath = join(
    channel.commandDirectory,
    "quality-bar-submit-runtime.js",
  );
  try {
    const commandStatus = lstatSync(commandPath);
    const runtimeStatus = lstatSync(runtimePath);
    assert.equal(commandStatus.mode & 0o777, 0o700);
    assert.equal(runtimeStatus.mode & 0o777, 0o600);
    assert.equal(runtimeStatus.isSymbolicLink(), false);
    assert.equal(dirname(commandPath), dirname(runtimePath));
    const commandSource = readFileSync(commandPath, "utf8");
    assert.match(
      commandSource,
      /new URL\(\s*"\.\/quality-bar-submit-runtime\.js"/s,
    );
    assert.match(
      commandSource,
      /data:text\/javascript;base64,\$\{runtimeSource\.toString\("base64"\)\}/,
    );
    assert.doesNotMatch(commandSource, /import\(runtimeUrl\.href\)/);
    assert.doesNotMatch(commandSource, /__QUALITY_BAR_SUBMIT_RUNTIME_SHA256__/);
    assert.equal(await submit(channel, checkoutPath), "");
    assert.equal(await channel.waitForResult(), "accepted");
  } finally {
    await channel.close();
  }
});

test("publishes the executable only after the validated runtime is visible", async (context) => {
  const checkoutPath = createCheckout(context);
  let commandPath = "";
  let runtimePath = "";
  /** @type {string[]} */
  const publications = [];
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    {
      checkoutPath,
      publishFile(temporaryPath, targetPath) {
        if (targetPath.endsWith("quality-bar-submit-runtime.js")) {
          runtimePath = targetPath;
          commandPath = join(dirname(targetPath), "quality-bar-submit");
          assert.equal(existsSync(commandPath), false);
          publications.push("runtime");
        } else if (targetPath.endsWith("quality-bar-submit")) {
          assert.equal(existsSync(runtimePath), true);
          assert.equal(existsSync(targetPath), false);
          publications.push("command");
        }
        return publishFile(temporaryPath, targetPath);
      },
    },
  );
  try {
    assert.deepEqual(publications, ["runtime", "command"]);
    assert.equal(existsSync(commandPath), true);
    assert.equal(await submit(channel, checkoutPath), "");
    assert.equal(await channel.waitForResult(), "accepted");
  } finally {
    await channel.close();
  }
});

test("preserves a foreign executable replacement when final publication fails", async (context) => {
  const checkoutPath = createCheckout(context);
  const publicationFailure = new Error("command publication failed");
  let commandPath = "";
  let commandDirectory = "";
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        claim,
        { prepare() {} },
        {
          checkoutPath,
          publishFile(temporaryPath, targetPath) {
            if (targetPath.endsWith("quality-bar-submit-runtime.js")) {
              return publishFile(temporaryPath, targetPath);
            }
            commandPath = targetPath;
            commandDirectory = dirname(targetPath);
            writeFileSync(commandPath, "foreign executable\n", { mode: 0o700 });
            throw publicationFailure;
          },
        },
      ),
    (error) => error === publicationFailure,
  );
  assert.equal(readFileSync(commandPath, "utf8"), "foreign executable\n");
  rmSync(commandDirectory, { force: true, recursive: true });
});

/** @type {Array<[string, (path: string) => void]>} */
const runtimeMutations = [
  ["missing", (path) => rmSync(path, { force: true })],
  [
    "tampered",
    (path) =>
      writeFileSync(path, `${readFileSync(path, "utf8")}\n// tampered\n`),
  ],
];
for (const [name, mutate] of runtimeMutations) {
  test(`fails fast when the sibling runtime is ${name}`, async (context) => {
    const checkoutPath = createCheckout(context);
    const channel = await openReviewRunSubmissionChannel(
      claim,
      { prepare() {} },
      { checkoutPath },
    );
    const runtimePath = join(
      channel.commandDirectory,
      "quality-bar-submit-runtime.js",
    );
    try {
      mutate(runtimePath);
      assert.equal(
        await submit(channel, checkoutPath),
        "submission_channel_unavailable: Review Run submission channel is unavailable\n",
      );
      assert.equal(existsSync(runtimePath), name === "tampered");
    } finally {
      await channel.close();
    }
  });
}

test("fails fast when the sibling runtime mode is tampered", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const runtimePath = join(
    channel.commandDirectory,
    "quality-bar-submit-runtime.js",
  );
  try {
    chmodSync(runtimePath, 0o640);
    assert.equal(
      await submit(channel, checkoutPath),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
  } finally {
    chmodSync(runtimePath, 0o600);
    await channel.close();
  }
});

test("fails fast when the sibling runtime is replaced with a same-byte symlink", async (context) => {
  const checkoutPath = createCheckout(context);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    { prepare() {} },
    { checkoutPath },
  );
  const runtimePath = join(
    channel.commandDirectory,
    "quality-bar-submit-runtime.js",
  );
  const copiedRuntimePath = `${runtimePath}.copy`;
  try {
    copyFileSync(runtimePath, copiedRuntimePath);
    chmodSync(copiedRuntimePath, 0o600);
    rmSync(runtimePath, { force: true });
    symlinkSync(copiedRuntimePath, runtimePath);
    assert.equal(
      await submit(channel, checkoutPath),
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
  } finally {
    rmSync(runtimePath, { force: true });
    rmSync(copiedRuntimePath, { force: true });
    await channel.close();
  }
});

test("client cleanup preserves a request replacement", async (context) => {
  const checkoutPath = createCheckout(context);
  const endpointName = ".qbs-client-cleanup.s";
  const requestPath = join(checkoutPath, endpointName);
  const channel = await openReviewRunSubmissionChannel(
    claim,
    {
      prepare() {
        writeFileSync(requestPath, "foreign-client-request\n");
      },
    },
    { checkoutPath, createEndpointName: () => endpointName },
  );
  try {
    assert.equal(await submit(channel, checkoutPath), "");
    assert.equal(await channel.waitForResult(), "accepted");
    assert.equal(readFileSync(requestPath, "utf8"), "foreign-client-request\n");
    rmSync(requestPath, { force: true });
  } finally {
    rmSync(requestPath, { force: true });
    await channel.close();
  }
});
