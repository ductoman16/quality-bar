export function gitPathFields(output: string | Buffer) {
  let decoded;
  try {
    decoded =
      typeof output === "string"
        ? output
        : new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(output);
  } catch (cause) {
    failEvaluation(
      "evaluation_file_change_invalid",
      "Git returned invalid UTF-8 File Change paths",
      cause,
    );
  }
  return decoded.split("\0").filter((field) => field.length > 0);
}

export function isNormalizedRepositoryPath(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function isValidFileChange(value: any) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    ![value.added, value.deleted, value.modified, value.renamed].every(
      (fact) => typeof fact === "boolean",
    )
  ) {
    return false;
  }
  const before = value.before_path;
  const after = value.after_path;
  if (
    !(before === null || isNormalizedRepositoryPath(before)) ||
    !(after === null || isNormalizedRepositoryPath(after))
  ) {
    return false;
  }
  if (value.added) {
    return (
      !value.deleted &&
      !value.modified &&
      !value.renamed &&
      before === null &&
      after !== null
    );
  }
  if (value.deleted) {
    return (
      !value.modified && !value.renamed && before !== null && after === null
    );
  }
  if (value.renamed) {
    return before !== null && after !== null && before !== after;
  }
  return value.modified && before !== null && after === before;
}

export function fileChangesFromGitNameStatus(output: string | Buffer) {
  const fields = gitPathFields(output);
  const changes = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    const firstPath = fields[index++];
    const renamed = /^R(\d{1,3})$/.exec(status);
    const afterPath = renamed ? fields[index++] : firstPath;
    if (
      typeof firstPath !== "string" ||
      typeof afterPath !== "string" ||
      (renamed && Number(renamed[1]) > 100)
    ) {
      failEvaluation(
        "evaluation_file_change_invalid",
        "Git returned an invalid frozen File Change",
      );
    }
    const facts =
      status === "A"
        ? {
            added: true,
            after_path: firstPath,
            before_path: null,
            deleted: false,
            modified: false,
            renamed: false,
          }
        : status === "D"
          ? {
              added: false,
              after_path: null,
              before_path: firstPath,
              deleted: true,
              modified: false,
              renamed: false,
            }
          : status === "M"
            ? {
                added: false,
                after_path: firstPath,
                before_path: firstPath,
                deleted: false,
                modified: true,
                renamed: false,
              }
            : renamed
              ? {
                  added: false,
                  after_path: afterPath,
                  before_path: firstPath,
                  deleted: false,
                  modified: Number(renamed[1]) < 100,
                  renamed: true,
                }
              : null;
    if (!facts) {
      failEvaluation(
        "evaluation_file_change_kind_unsupported",
        `Git File Change status ${status} is unsupported`,
      );
    }
    const change = {
      ...facts,
      id: `file-change-${changes.length + 1}`,
    } as any;
    if (!isValidFileChange(change)) {
      failEvaluation(
        "evaluation_file_change_invalid",
        `Frozen File Change ${change.id} is invalid`,
      );
    }
    changes.push(change);
  }
  return changes;
}
import { failEvaluation } from "./evaluation/evaluation-validation.ts";
