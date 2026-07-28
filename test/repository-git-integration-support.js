import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

import { resolvePushedCommitSelectors } from "../src/repository-git.js";

/**
 * @param {string} directory
 * @param {string} name
 * @param {boolean} populated
 * @param {"sha1" | "sha256"} [objectFormat]
 */
export function createBareRepository(
  directory,
  name,
  populated,
  objectFormat = "sha1",
) {
  const repository = join(directory, `${name}.git`);
  if (populated) {
    const source = join(directory, `${name}-source`);
    execFileSync(
      "git",
      [
        "init",
        `--object-format=${objectFormat}`,
        "--initial-branch=main",
        source,
      ],
      { stdio: "ignore" },
    );
    execFileSync("git", ["-C", source, "config", "user.name", "Quality Bar"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", source, "config", "user.email", "quality-bar@example.invalid"],
      { stdio: "ignore" },
    );
    execFileSync(
      "git",
      ["-C", source, "commit", "--allow-empty", "-m", "fact"],
      { stdio: "ignore" },
    );
    execFileSync("git", ["clone", "--bare", source, repository], {
      stdio: "ignore",
    });
  } else {
    execFileSync(
      "git",
      ["init", "--bare", `--object-format=${objectFormat}`, repository],
      { stdio: "ignore" },
    );
  }
  execFileSync("git", ["--git-dir", repository, "update-server-info"], {
    stdio: "ignore",
  });
}

/**
 * @param {string} url
 * @param {string} certificateAuthorityPath
 * @param {string[]} redirectedAuthorizationHeaders
 */
export async function assertCredentialedAcquisitionRejectsRedirect(
  url,
  certificateAuthorityPath,
  redirectedAuthorizationHeaders,
) {
  const previousCount = redirectedAuthorizationHeaders.length;
  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        url,
        { token: "private-token-value", username: "operator" },
        {
          base: { type: "branch", value: "main" },
          head: { type: "branch", value: "main" },
        },
        {
          certificateAuthorityPath,
          objectDatabaseRoot: dirname(certificateAuthorityPath),
        },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "evaluation_git_acquisition_failed",
  );
  assert.equal(redirectedAuthorizationHeaders.length, previousCount);
}
