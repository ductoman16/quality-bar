import assert from "node:assert/strict";

export function proveBundledTools({
  fixture,
  serviceName,
}: {
  fixture: import("./package-fixture.mts").PackageFixture;
  serviceName: string;
}) {
  const toolVersions = {
    codex: fixture
      .runCompose(["exec", "-T", serviceName, "codex", "--version"])
      .replace("codex-cli ", ""),
    git: fixture
      .runCompose(["exec", "-T", serviceName, "git", "--version"])
      .replace("git version ", ""),
  };
  assert.equal(toolVersions.git, "2.54.0");
  assert.equal(toolVersions.codex, "0.145.0");
  return toolVersions;
}
