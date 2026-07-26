import { ESLint } from "eslint";
import { relative, resolve } from "node:path";

import { listMaintainedJavaScriptFiles } from "./structural-lint.mjs";

/** @param {string} repositoryRoot @param {string} path */
function relativePath(repositoryRoot, path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

/**
 * @param {string} path
 * @param {import("eslint").Linter.LintMessage} message
 */
function reportDiagnostic(path, message) {
  return `node_boundary_lint: ${path}:${message.line}:${message.column} [${message.ruleId ?? "configuration"}] ${message.message}`;
}

/**
 * @param {{
 *   repositoryRoot?: string,
 *   files?: {path: string, source: string}[],
 * }} [options]
 */
export async function runNodeBoundaryLint({
  repositoryRoot = resolve(import.meta.dirname, ".."),
  files,
} = {}) {
  const eslint = new ESLint({ cwd: repositoryRoot });
  /** @type {string[]} */
  const diagnostics = [];
  /** @type {import("eslint").ESLint.LintResult[]} */
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
          `node_boundary_lint_unapproved_exclusion: ${relativePath(repositoryRoot, file)}`,
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
        ? `node_boundary_lint: PASS (${results.length} maintained JavaScript files, zero warnings)\n`
        : `${diagnostics.join("\n")}\n`,
  };
}

if (import.meta.main) {
  const result = await runNodeBoundaryLint();
  process.stdout.write(result.report);
  if (result.outcome === "fail") {
    process.exitCode = 1;
  }
}
