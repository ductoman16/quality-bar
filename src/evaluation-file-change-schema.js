import { isNormalizedRepositoryPath } from "./file-change.js";

/** @param {unknown} beforePath @param {unknown} afterPath */
export function legacyFileChangePathsValid(beforePath, afterPath) {
  if (
    !(beforePath === null || isNormalizedRepositoryPath(beforePath)) ||
    !(afterPath === null || isNormalizedRepositoryPath(afterPath))
  ) {
    throw new TypeError("Legacy File Change path is invalid");
  }
  return 1;
}

/**
 * @param {unknown} beforePath
 * @param {unknown} afterPath
 * @param {unknown} patch
 */
export function legacyFileChangeModified(beforePath, afterPath, patch) {
  if (
    !(beforePath === null || typeof beforePath === "string") ||
    !(afterPath === null || typeof afterPath === "string") ||
    typeof patch !== "string"
  ) {
    throw new TypeError("Legacy File Change facts are invalid");
  }
  if (beforePath === null || afterPath === null) {
    return 0;
  }
  if (beforePath === afterPath) {
    const oldModes = patch
      .split("\n")
      .filter((line) => line.startsWith("old mode "));
    const newModes = patch
      .split("\n")
      .filter((line) => line.startsWith("new mode "));
    if (
      oldModes.length !== newModes.length ||
      oldModes.length > 1 ||
      (oldModes.length === 1 &&
        (!/^old mode [0-7]{6}$/.test(oldModes[0]) ||
          !/^new mode [0-7]{6}$/.test(newModes[0]) ||
          oldModes[0].slice(-6, -3) !== newModes[0].slice(-6, -3)))
    ) {
      throw new TypeError("Legacy File Change kind is unsupported");
    }
    return 1;
  }
  const similarityLines = patch
    .split("\n")
    .filter((line) => line.startsWith("similarity index "));
  if (
    similarityLines.length !== 1 ||
    !/^similarity index (?:100|[0-9]{1,2})%$/.test(similarityLines[0])
  ) {
    throw new TypeError(
      "Legacy renamed File Change similarity metadata is invalid",
    );
  }
  return similarityLines[0] === "similarity index 100%" ? 0 : 1;
}

export const EVALUATION_FILE_CHANGE_KIND_MIGRATION = `
  DROP TRIGGER IF EXISTS evaluation_file_change_immutable_update;
  DROP TRIGGER IF EXISTS evaluation_file_change_immutable_delete;
  ALTER TABLE evaluation_file_changes
    ADD COLUMN added INTEGER CHECK (added IN (0, 1));
  ALTER TABLE evaluation_file_changes
    ADD COLUMN deleted INTEGER CHECK (deleted IN (0, 1));
  ALTER TABLE evaluation_file_changes
    ADD COLUMN modified INTEGER CHECK (modified IN (0, 1));
  ALTER TABLE evaluation_file_changes
    ADD COLUMN renamed INTEGER CHECK (renamed IN (0, 1));
  UPDATE evaluation_file_changes
  SET added = before_path IS NULL,
      deleted = after_path IS NULL,
      renamed = before_path IS NOT NULL
        AND after_path IS NOT NULL
        AND before_path <> after_path,
      modified = quality_bar_legacy_file_change_modified(
        before_path,
        after_path,
        patch
      )
  WHERE quality_bar_legacy_file_change_paths_valid(
    before_path,
    after_path
  ) = 1;
`;

export const EVALUATION_FILE_CHANGE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS evaluation_file_changes (
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    id TEXT NOT NULL,
    added INTEGER NOT NULL CHECK (added IN (0, 1)),
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    modified INTEGER NOT NULL CHECK (modified IN (0, 1)),
    renamed INTEGER NOT NULL CHECK (renamed IN (0, 1)),
    before_path TEXT,
    after_path TEXT,
    base_line_count INTEGER CHECK (base_line_count IS NULL OR base_line_count >= 0),
    head_line_count INTEGER CHECK (head_line_count IS NULL OR head_line_count >= 0),
    patch TEXT NOT NULL,
    PRIMARY KEY (evaluation_id, id),
    CHECK (
      (added = 1 AND deleted = 0 AND modified = 0 AND renamed = 0
        AND before_path IS NULL AND after_path IS NOT NULL)
      OR
      (added = 0 AND deleted = 1 AND modified = 0 AND renamed = 0
        AND before_path IS NOT NULL AND after_path IS NULL)
      OR
      (added = 0 AND deleted = 0 AND modified = 1 AND renamed = 0
        AND before_path IS NOT NULL AND after_path = before_path)
      OR
      (added = 0 AND deleted = 0 AND modified IN (0, 1) AND renamed = 1
        AND before_path IS NOT NULL AND after_path IS NOT NULL
        AND after_path <> before_path)
    )
  ) STRICT;
`;

export const EVALUATION_FILE_CHANGE_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS evaluation_file_change_immutable_update
    BEFORE UPDATE ON evaluation_file_changes
    BEGIN SELECT RAISE(ABORT, 'evaluation_file_change_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_file_change_immutable_delete
    BEFORE DELETE ON evaluation_file_changes
    BEGIN SELECT RAISE(ABORT, 'evaluation_file_change_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_file_change_kind_insert
    BEFORE INSERT ON evaluation_file_changes
    WHEN NEW.added IS NULL
      OR NEW.deleted IS NULL
      OR NEW.modified IS NULL
      OR NEW.renamed IS NULL
      OR NOT (
        (NEW.added = 1 AND NEW.deleted = 0
          AND NEW.modified = 0 AND NEW.renamed = 0
          AND NEW.before_path IS NULL AND NEW.after_path IS NOT NULL)
        OR
        (NEW.added = 0 AND NEW.deleted = 1
          AND NEW.modified = 0 AND NEW.renamed = 0
          AND NEW.before_path IS NOT NULL AND NEW.after_path IS NULL)
        OR
        (NEW.added = 0 AND NEW.deleted = 0
          AND NEW.modified = 1 AND NEW.renamed = 0
          AND NEW.before_path IS NOT NULL AND NEW.after_path = NEW.before_path)
        OR
        (NEW.added = 0 AND NEW.deleted = 0
          AND NEW.modified IN (0, 1) AND NEW.renamed = 1
          AND NEW.before_path IS NOT NULL AND NEW.after_path IS NOT NULL
          AND NEW.after_path <> NEW.before_path)
      )
    BEGIN SELECT RAISE(ABORT, 'evaluation_file_change_kind_invalid'); END;
`;
