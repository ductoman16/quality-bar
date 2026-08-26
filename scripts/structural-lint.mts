import { ESLint } from "eslint";
import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { isGeneratedArtifact } from "./structural-lint-policy.mts";

const JAVASCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".mjs",
  ".mts",
  ".ts",
]);
const UNMAINTAINED_DIRECTORIES = new Set([".git", "node_modules"]);

function relativePath(repositoryRoot: string, path: string) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function isJavaScriptFile(path: string) {
  return [...JAVASCRIPT_EXTENSIONS].some((extension) =>
    path.endsWith(extension),
  );
}

function collectJavaScriptFiles(
  repositoryRoot: string,
  directory: string,
  files: string[],
) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const directoryPath = relativePath(repositoryRoot, path);
      if (
        !UNMAINTAINED_DIRECTORIES.has(entry.name) &&
        !isGeneratedArtifact(directoryPath)
      ) {
        collectJavaScriptFiles(repositoryRoot, path, files);
      }
    } else if (entry.isFile() && isJavaScriptFile(path)) {
      files.push(path);
    }
  }
}

export function listMaintainedJavaScriptFiles(repositoryRoot: string) {
  const files: string[] = [];
  collectJavaScriptFiles(repositoryRoot, repositoryRoot, files);
  return files.sort();
}

function reportDiagnostic(code: string, path: string, message: string = "") {
  return `${code}: ${path}${message ? ` ${message}` : ""}`;
}

function hasRequiredMaxLinesRule(
  config: import("eslint").Linter.Config | undefined,
) {
  const rule = config?.rules?.["max-lines"];
  const options = Array.isArray(rule) ? rule[1] : undefined;
  return (
    Array.isArray(rule) &&
    rule[0] === 2 &&
    typeof options === "object" &&
    options !== null &&
    "max" in options &&
    options.max === 900 &&
    "skipBlankLines" in options &&
    options.skipBlankLines === true &&
    "skipComments" in options &&
    options.skipComments === true
  );
}

export async function runStructuralLint({
  repositoryRoot = resolve(import.meta.dirname, ".."),
  configFile = "eslint.config.js",
}: { repositoryRoot?: string; configFile?: string } = {}) {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: resolve(repositoryRoot, configFile),
  });
  const files = listMaintainedJavaScriptFiles(repositoryRoot);
  const diagnostics: string[] = [];
  const lintableFiles: string[] = [];

  for (const file of files) {
    const path = relativePath(repositoryRoot, file);
    const configuration = await eslint.calculateConfigForFile(file);
    if (await eslint.isPathIgnored(file)) {
      diagnostics.push(
        reportDiagnostic("structural_lint_unapproved_exclusion", path),
      );
    } else if (!configuration?.rules?.["max-lines"]) {
      diagnostics.push(
        reportDiagnostic("structural_lint_omitted_maintained_file", path),
      );
    } else if (!hasRequiredMaxLinesRule(configuration)) {
      diagnostics.push(
        reportDiagnostic(
          "structural_lint_invalid_max_lines_configuration",
          path,
        ),
      );
    } else {
      lintableFiles.push(file);
    }
  }

  const results = await eslint.lintFiles(lintableFiles);
  for (const result of results) {
    const path = relativePath(repositoryRoot, result.filePath);
    for (const message of result.messages) {
      const code = message.message.includes("no effect because you have")
        ? "structural_lint_inline_suppression"
        : message.ruleId === "max-lines"
          ? "structural_lint_max_lines"
          : "structural_lint_error";
      diagnostics.push(
        reportDiagnostic(
          code,
          `${path}:${message.line}:${message.column} [${message.ruleId ?? "configuration"}]`,
          message.message,
        ),
      );
    }
  }

  return {
    outcome: diagnostics.length === 0 ? "pass" : "fail",
    report:
      diagnostics.length === 0
        ? `structural_lint: PASS (${files.length} maintained JavaScript files, zero warnings)\n`
        : `${diagnostics.join("\n")}\n`,
  };
}

if (import.meta.main) {
  const result = await runStructuralLint();
  process.stdout.write(result.report);
  if (result.outcome === "fail") {
    process.exitCode = 1;
  }
}
