import { ESLint } from "eslint";
import { relative, resolve } from "node:path";

import { listMaintainedJavaScriptFiles } from "./structural-lint.mjs";

function relativePath(repositoryRoot, path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function reportDiagnostic(path, message) {
  return `core_javascript_lint: ${path}:${message.line}:${message.column} [${message.ruleId ?? "configuration"}] ${message.message}`;
}

export async function runCoreJavaScriptLint({
  repositoryRoot = resolve(import.meta.dirname, ".."),
  files,
} = {}) {
  const eslint = new ESLint({ cwd: repositoryRoot });
  const diagnostics = [];
  let results;

  if (files) {
    results = (
      await Promise.all(
        files.map(async ({ path, source }) => {
          return eslint.lintText(source, { filePath: path });
        }),
      )
    ).flat();
  } else {
    const maintainedFiles = listMaintainedJavaScriptFiles(repositoryRoot);
    const lintableFiles = [];
    for (const file of maintainedFiles) {
      if (await eslint.isPathIgnored(file)) {
        diagnostics.push(
          `core_javascript_lint_unapproved_exclusion: ${relativePath(repositoryRoot, file)}`,
        );
      } else {
        lintableFiles.push(file);
      }
    }
    results = await eslint.lintFiles(lintableFiles);
  }

  for (const result of results) {
    const path = relativePath(repositoryRoot, result.filePath);
    for (const message of result.messages) {
      diagnostics.push(reportDiagnostic(path, message));
    }
  }

  return {
    outcome: diagnostics.length === 0 ? "pass" : "fail",
    report:
      diagnostics.length === 0
        ? `core_javascript_lint: PASS (${results.length} maintained JavaScript files, zero warnings)\n`
        : `${diagnostics.join("\n")}\n`,
  };
}

if (import.meta.main) {
  const result = await runCoreJavaScriptLint();
  process.stdout.write(result.report);
  if (result.outcome === "fail") {
    process.exitCode = 1;
  }
}
