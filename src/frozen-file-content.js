import { execFileSync } from "node:child_process";

const GIT_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

/**
 * @param {string} code
 * @param {string} detail
 * @param {unknown} [cause]
 */
function contentFailure(code, detail, cause) {
  return Object.assign(new Error(detail), {
    ...(cause === undefined ? {} : { cause }),
    code,
  });
}

/**
 * @param {string} objectDatabase
 * @param {string} commit
 * @param {string} path
 * @param {"before" | "after"} side
 */
function readTreeEntry(objectDatabase, commit, path, side) {
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "-C",
        objectDatabase,
        "ls-tree",
        "-z",
        commit,
        "--",
        `:(literal)${path}`,
      ],
      { env: GIT_ENVIRONMENT, maxBuffer: Number.MAX_SAFE_INTEGER },
    );
  } catch (cause) {
    throw contentFailure(
      "applicability_file_side_unreadable",
      `The frozen ${side} side could not be read.`,
      cause,
    );
  }
  const separator = output.indexOf(9);
  const terminator = output.indexOf(0, separator + 1);
  const header =
    separator > 0 ? output.subarray(0, separator).toString("ascii") : "";
  const parsed = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64})$/.exec(header);
  let entryPath;
  try {
    entryPath =
      terminator > separator
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            output.subarray(separator + 1, terminator),
          )
        : "";
  } catch {
    entryPath = "";
  }
  if (!parsed || entryPath !== path || terminator !== output.length - 1) {
    throw contentFailure(
      "applicability_file_side_unprocessable",
      `The frozen ${side} side could not be processed.`,
    );
  }
  return { objectId: parsed[3], type: parsed[2] };
}

/**
 * @param {string} objectDatabase
 * @param {string} objectId
 * @param {"before" | "after"} side
 */
function readBlob(objectDatabase, objectId, side) {
  try {
    return execFileSync(
      "git",
      ["-C", objectDatabase, "cat-file", "blob", objectId],
      { env: GIT_ENVIRONMENT, maxBuffer: Number.MAX_SAFE_INTEGER },
    );
  } catch (cause) {
    throw contentFailure(
      "applicability_file_side_unreadable",
      `The frozen ${side} side could not be read.`,
      cause,
    );
  }
}

/** @param {Buffer} bytes */
function classify(bytes) {
  if (bytes.includes(0)) {
    return { state: "binary" };
  }
  try {
    return {
      state: "text",
      value: new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes),
    };
  } catch {
    return { state: "binary" };
  }
}

/**
 * @param {{
 *   baseCommit: string,
 *   fileChanges: any[],
 *   headCommit: string,
 *   objectDatabase: string
 * }} options
 */
export function createFrozenFileContentReader({
  baseCommit,
  fileChanges,
  headCommit,
  objectDatabase,
}) {
  const fileChangesById = new Map(
    fileChanges.map((fileChange) => [fileChange.id, fileChange]),
  );
  const contentByObjectId = new Map();
  /** @param {any} fileChange @param {"before" | "after"} side */
  function readContent(fileChange, side) {
    if (
      !fileChange ||
      fileChangesById.get(fileChange.id) !== fileChange ||
      !["before", "after"].includes(side)
    ) {
      throw new TypeError("Frozen File Change content request is invalid");
    }
    const path = fileChange[`${side}_path`];
    if (path === null) {
      return { state: "absent" };
    }
    const commit = side === "before" ? baseCommit : headCommit;
    const entry = readTreeEntry(objectDatabase, commit, path, side);
    if (entry.type === "commit") {
      throw contentFailure(
        "applicability_file_side_unprocessable",
        `The frozen ${side} side could not be processed.`,
      );
    }
    if (!contentByObjectId.has(entry.objectId)) {
      contentByObjectId.set(
        entry.objectId,
        classify(readBlob(objectDatabase, entry.objectId, side)),
      );
    }
    return contentByObjectId.get(entry.objectId);
  }
  return readContent;
}
