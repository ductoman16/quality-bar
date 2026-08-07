import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const workflowPath = new URL(
  "../.github/workflows/canonical-verification.yml",
  import.meta.url,
);
const dependabotPath = new URL("../.github/dependabot.yml", import.meta.url);

/** @param {URL} path */
function readYaml(path) {
  const document = parseDocument(readFileSync(path, "utf8"));
  assert.deepEqual(
    document.errors,
    [],
    document.errors.map((error) => error.message).join("\n"),
  );
  return document.toJS();
}

test("GitHub runs only canonical verification with pinned prerequisites", () => {
  const workflow = readYaml(workflowPath);
  assert.equal(workflow.name, "Canonical verification");
  assert.deepEqual(workflow.on, {
    pull_request: {},
    push: { branches: ["main"] },
  });
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const job = workflow.jobs.verify;
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 30);

  const steps =
    /** @type {{uses: string, run: string, with: Record<string, any>, if: string, id: string, env: Record<string, string>}[]} */ (
      job.steps
    );
  const actionSteps = steps.filter((step) => step.uses);
  assert.deepEqual(
    actionSteps.map((step) => step.uses),
    [
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
      "browser-actions/setup-firefox@0bc507ddf224827e3b1af68e014d5e42ab93e795",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    ],
  );
  for (const step of actionSteps) {
    assert.match(step.uses, /@[0-9a-f]{40}$/u);
  }

  const checkout = actionSteps[0];
  assert.equal(checkout.with["fetch-depth"], 0);

  const node = actionSteps[1];
  assert.equal(node.with["node-version"], "24.18.0");
  assert.equal(node.with.cache, "npm");
  assert.equal(node.with["cache-dependency-path"], "package-lock.json");

  const firefox = actionSteps[2];
  assert.equal(firefox.id, "firefox");
  assert.equal(firefox.with["firefox-version"], "153.0");

  const commands = steps.filter((step) => step.run).map((step) => step.run);
  assert.ok(commands.includes("npm ci"));
  assert.ok(
    commands.some(
      (command) =>
        command.includes('test "$(uname -m)" = "x86_64"') &&
        command.includes("docker version") &&
        command.includes("docker compose version") &&
        command.includes("firefox --version") &&
        command.includes(
          "sudo sysctl --write kernel.apparmor_restrict_unprivileged_userns=0",
        ) &&
        command.includes(
          'test "$(sysctl --values kernel.apparmor_restrict_unprivileged_userns)" = "0"',
        ),
    ),
  );
  assert.deepEqual(
    commands.filter((command) => command.startsWith("npm run ")),
    ["npm run verify"],
  );
  const verification = steps.find((step) => step.run === "npm run verify");
  assert.ok(verification);
  assert.match(
    JSON.stringify(verification),
    /"env":\{"QUALITY_BAR_FIREFOX_BINARY":"\$\{\{ steps\.firefox\.outputs\.firefox-path \}\}"\}/u,
  );

  const artifact = actionSteps[3];
  assert.equal(artifact.if, "always()");
  assert.equal(artifact.with.name, "canonical-verification-evidence");
  assert.equal(artifact.with.path, "artifacts/verification/evidence.json");
  assert.equal(artifact.with["if-no-files-found"], "error");
});

test("Dependabot schedules one grouped update stream per owned ecosystem", () => {
  const configuration = readYaml(dependabotPath);
  assert.equal(configuration.version, 2);
  assert.equal(configuration.updates.length, 3);

  const expectedGroups = new Map([
    ["npm", "npm-dependencies"],
    ["docker", "docker-dependencies"],
    ["github-actions", "github-actions-dependencies"],
  ]);
  for (const update of configuration.updates) {
    const groupName = expectedGroups.get(update["package-ecosystem"]);
    assert.ok(groupName, `unexpected ecosystem ${update["package-ecosystem"]}`);
    assert.equal(update.directory, "/");
    assert.deepEqual(update.schedule, { interval: "weekly" });
    assert.deepEqual(update.groups, {
      [groupName]: { patterns: ["*"] },
    });
    assert.equal("assignees" in update, false);
    assert.equal("reviewers" in update, false);
  }
});

test("ticket evidence records immutable inputs and the unchanged smoke scope", () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../evidence/quality-foundation/issue-166-github-automation.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 166);
  assert.equal(evidence.node, "24.18.0");
  assert.equal(evidence.firefox, "153.0");
  assert.equal(evidence.yaml_parser, "yaml:2.9.0");
  assert.equal(
    evidence.firefox_sandbox_prerequisite,
    "kernel.apparmor_restrict_unprivileged_userns=0",
  );
  assert.equal(evidence.install_command, "npm ci");
  assert.equal(evidence.acceptance_command, "npm run verify");
  assert.deepEqual(evidence.dependabot_ecosystems, [
    "npm",
    "docker",
    "github-actions",
  ]);
  assert.deepEqual(evidence.cross_process_smokes, [
    "authenticated-firefox-browser-cross-process",
    "packaged-compose-http-mcp-cross-process",
  ]);
  assert.equal(evidence.new_e2e_scenarios, 0);
  assert.equal(evidence.mutable_repository_settings_changed, false);
  assert.equal(evidence.final_outcome, "pass");
});
