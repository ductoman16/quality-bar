import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { evaluateApplicabilityRule } from "../src/applicability-evaluation.js";
import { resolvePushedCommitSelectors } from "../src/repository-git.js";
import { createBareRepository } from "./repository-git-integration-support.js";

test("a Boolean Applicability Rule evaluates against exact commits frozen by real Git acquisition", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  createBareRepository(directory, "repository", true);
  const repository = join(directory, "repository.git");
  const commit = execFileSync(
    "git",
    ["--git-dir", repository, "rev-parse", "main"],
    { encoding: "utf8" },
  ).trim();
  const frozen = await resolvePushedCommitSelectors(
    pathToFileURL(repository).href,
    undefined,
    {
      base: { type: "commit", value: commit },
      head: { type: "branch", value: "main" },
    },
    { objectDatabaseRoot: directory },
  );
  try {
    assert.equal(frozen.base_commit, commit);
    assert.equal(frozen.head_commit, commit);
    assert.deepEqual(frozen.file_changes, []);
    assert.equal(
      evaluateApplicabilityRule("true", frozen, {
        matchesPath() {
          throw new Error("Boolean Rule must not request File Change matching");
        },
      }).outcome,
      "applicable",
    );
  } finally {
    frozen.release();
  }
});

test("real Git acquisition models every File Change kind and matches each touched side with authored positive globs", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-file-change-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", source, "config", "user.name", "Quality Bar"]);
  execFileSync("git", [
    "-C",
    source,
    "config",
    "user.email",
    "quality-bar@example.invalid",
  ]);
  writeFileSync(join(source, "deleted.txt"), "deleted\n");
  writeFileSync(join(source, "modified.txt"), "before\n");
  writeFileSync(join(source, "rename.txt"), "same\n");
  writeFileSync(
    join(source, "rename-modified.txt"),
    "one\ntwo\nthree\nfour\nfive\n",
  );
  execFileSync("git", ["-C", source, "add", "--all"]);
  execFileSync("git", ["-C", source, "commit", "-m", "base"], {
    stdio: "ignore",
  });
  const base = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  rmSync(join(source, "deleted.txt"));
  writeFileSync(join(source, "modified.txt"), "after\n");
  renameSync(join(source, "rename.txt"), join(source, "renamed.txt"));
  renameSync(
    join(source, "rename-modified.txt"),
    join(source, "renamed-modified.txt"),
  );
  writeFileSync(
    join(source, "renamed-modified.txt"),
    "one\ntwo\nthree\nfour\nchanged\n",
  );
  writeFileSync(join(source, "added.txt"), "added\n");
  writeFileSync(join(source, "src", "Case.js"), "case-sensitive\n");
  execFileSync("git", ["-C", source, "add", "--all"]);
  execFileSync("git", ["-C", source, "commit", "-m", "head"], {
    stdio: "ignore",
  });
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const repository = join(directory, "repository.git");
  execFileSync("git", ["clone", "--bare", source, repository], {
    stdio: "ignore",
  });

  const frozen = await resolvePushedCommitSelectors(
    pathToFileURL(repository).href,
    undefined,
    {
      base: { type: "commit", value: base },
      head: { type: "commit", value: head },
    },
    { objectDatabaseRoot: directory },
  );
  try {
    assert.deepEqual(
      frozen.file_changes.map(
        ({ added, deleted, modified, renamed, before_path, after_path }) => ({
          added,
          after_path,
          before_path,
          deleted,
          modified,
          renamed,
        }),
      ),
      [
        {
          added: true,
          after_path: "added.txt",
          before_path: null,
          deleted: false,
          modified: false,
          renamed: false,
        },
        {
          added: false,
          after_path: null,
          before_path: "deleted.txt",
          deleted: true,
          modified: false,
          renamed: false,
        },
        {
          added: false,
          after_path: "modified.txt",
          before_path: "modified.txt",
          deleted: false,
          modified: true,
          renamed: false,
        },
        {
          added: false,
          after_path: "renamed-modified.txt",
          before_path: "rename-modified.txt",
          deleted: false,
          modified: true,
          renamed: true,
        },
        {
          added: false,
          after_path: "renamed.txt",
          before_path: "rename.txt",
          deleted: false,
          modified: false,
          renamed: true,
        },
        {
          added: true,
          after_path: "src/Case.js",
          before_path: null,
          deleted: false,
          modified: false,
          renamed: false,
        },
      ],
    );
    for (const rule of [
      'file_changes.exists(file, file.deleted && file.before_path.matches(":(glob)deleted.txt"))',
      'file_changes.exists(file, file.renamed && file.before_path.matches(":(glob)rename*.txt"))',
      'file_changes.exists(file, file.renamed && file.after_path.matches(":(glob)renamed*.txt"))',
      'file_changes.exists(file, file.paths.exists(path, path.matches(":(glob)rename*.txt")))',
      'file_changes.exists(file, file.paths.exists(path, path.matches(":(glob)renamed*.txt")))',
      'file_changes.exists(file, file.added && file.after_path.matches(":(glob)src/*.js"))',
    ]) {
      assert.equal(
        evaluateApplicabilityRule(rule, frozen, {
          matchesPath: frozen.matches_path,
        }).outcome,
        "applicable",
      );
    }
    assert.equal(
      evaluateApplicabilityRule(
        'file_changes.exists(file, file.after_path.matches(":(glob)src/case.js"))',
        frozen,
        { matchesPath: frozen.matches_path },
      ).outcome,
      "not_applicable",
    );
  } finally {
    frozen.release();
  }
});

test("real Git acquisition reads complete text while absent and binary sides stay outside content predicates", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-content-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", source, "config", "user.name", "Quality Bar"]);
  execFileSync("git", [
    "-C",
    source,
    "config",
    "user.email",
    "quality-bar@example.invalid",
  ]);
  writeFileSync(join(source, "deleted.txt"), "complete base marker\n");
  writeFileSync(join(source, "modified.txt"), "before\n");
  execFileSync("git", ["-C", source, "add", "--all"]);
  execFileSync("git", ["-C", source, "commit", "-m", "base"], {
    stdio: "ignore",
  });
  const base = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  rmSync(join(source, "deleted.txt"));
  writeFileSync(
    join(source, "modified.txt"),
    "prefix\ncomplete 雪だるま text\nsuffix\n",
  );
  writeFileSync(join(source, "generated.js"), "generated text marker\n");
  writeFileSync(join(source, "nul.bin"), Buffer.from([116, 101, 120, 116, 0]));
  writeFileSync(join(source, "invalid-utf8.bin"), Buffer.from([0xc3, 0x28]));
  execFileSync("git", ["-C", source, "add", "--all"]);
  execFileSync("git", [
    "-C",
    source,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${base},gitlink`,
  ]);
  execFileSync("git", ["-C", source, "commit", "-m", "head"], {
    stdio: "ignore",
  });
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const repository = join(directory, "repository.git");
  execFileSync("git", ["clone", "--bare", source, repository], {
    stdio: "ignore",
  });

  const frozen = await resolvePushedCommitSelectors(
    pathToFileURL(repository).href,
    undefined,
    {
      base: { type: "commit", value: base },
      head: { type: "commit", value: head },
    },
    { objectDatabaseRoot: directory },
  );
  try {
    for (const rule of [
      'file_changes.exists(file, file.before_path.matches(":(glob)deleted.txt") && file.before_content.matches("complete base marker"))',
      'file_changes.exists(file, file.after_path.matches(":(glob)modified.txt") && file.after_content.matches("complete 雪だるま text"))',
      'file_changes.exists(file, file.after_path.matches(":(glob)generated.js") && file.after_content.matches("generated text marker"))',
    ]) {
      assert.equal(
        evaluateApplicabilityRule(rule, frozen, {
          matchesPath: frozen.matches_path,
          readContent: frozen.read_content,
        }).outcome,
        "applicable",
        rule,
      );
    }
    for (const rule of [
      'file_changes.exists(file, file.added && !file.before_content.matches("anything"))',
      'file_changes.exists(file, file.after_path.matches(":(glob)nul.bin") && file.after_content.matches("text"))',
      'file_changes.exists(file, file.after_path.matches(":(glob)nul.bin") && !file.after_content.matches("text"))',
      'file_changes.exists(file, file.after_path.matches(":(glob)invalid-utf8.bin") && !file.after_content.matches("text"))',
    ]) {
      assert.equal(
        evaluateApplicabilityRule(rule, frozen, {
          matchesPath: frozen.matches_path,
          readContent: frozen.read_content,
        }).outcome,
        "not_applicable",
        rule,
      );
    }
    const gitlinkRule =
      'file_changes.exists(file, file.after_path.matches(":(glob)gitlink") && file.after_content.matches("anything"))';
    assert.deepEqual(
      evaluateApplicabilityRule(gitlinkRule, frozen, {
        matchesPath: frozen.matches_path,
        readContent: frozen.read_content,
      }),
      {
        error: {
          code: "applicability_file_side_unprocessable",
          detail: "The frozen after side could not be processed.",
          file_change_id: "file-change-3",
          predicate_id: "predicate-3",
          side: "after",
        },
        outcome: "error",
        profile: "quality-bar-restricted-cel-v1",
        source: gitlinkRule,
      },
    );
  } finally {
    frozen.release();
  }
});
