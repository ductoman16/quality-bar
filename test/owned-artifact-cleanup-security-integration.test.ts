import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cleanupOwnedTemporaryArtifacts } from "../src/owned-artifact-cleanup.ts";

test("owned cleanup never follows a Repository-controlled symlink", (context) => {
  const fixture = join(
    tmpdir(),
    `quality-bar-owned-artifact-security-${Math.random().toString(16).slice(2)}`,
  );
  const checkoutRoot = join(fixture, "checkouts");
  const repositoryPath = join(checkoutRoot, "repository-controlled");
  const canonicalFact = join(fixture, "canonical-fact");
  mkdirSync(repositoryPath, { recursive: true });
  writeFileSync(canonicalFact, "must remain");
  symlinkSync(canonicalFact, join(repositoryPath, "checkout-link"));
  context.after(() => rmSync(fixture, { force: true, recursive: true }));

  cleanupOwnedTemporaryArtifacts({
    checkoutRoot,
    durableCore: { all: () => [] },
  });

  assert.equal(existsSync(repositoryPath), false);
  assert.equal(existsSync(canonicalFact), true);
});
