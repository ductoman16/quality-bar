import { projectForgejoDiffLineRange } from "./forgejo-feedback.js";

/** @param {any} durableCore @param {any} bundle @param {any[]} findings */
export function materializeForgejoFindingFeedback(
  durableCore,
  bundle,
  findings,
) {
  const fileChanges = new Map(
    durableCore
      .all(
        `SELECT id, before_path, after_path, patch
         FROM evaluation_file_changes
         WHERE evaluation_id = ?`,
        bundle.evaluation_id,
      )
      .map((/** @type {any} */ fileChange) => [fileChange?.id, fileChange]),
  );
  durableCore.transaction((/** @type {any} */ transaction) => {
    const existing = transaction.all(
      `SELECT finding_id
       FROM forgejo_finding_feedback
       WHERE evaluation_id = ?`,
      bundle.evaluation_id,
    );
    if (existing.length !== 0) {
      if (
        existing.length !== findings.length ||
        existing.some(
          (/** @type {any} */ { finding_id: findingId }) =>
            !findings.some(({ id }) => id === findingId),
        )
      ) {
        throw new TypeError("Forgejo Finding feedback set is invalid");
      }
      return;
    }
    for (const finding of findings) {
      const fileChange =
        finding.location.file_change_id === undefined
          ? undefined
          : fileChanges.get(finding.location.file_change_id);
      const coordinate = fileChange
        ? projectForgejoDiffLineRange(finding.location, fileChange)
        : null;
      const unavailable =
        coordinate && bundle.publication_status === "unavailable";
      const errorDetail =
        bundle.error_code === "forgejo_connection_retired"
          ? "Forgejo inline feedback publication is unavailable because the Forgejo Connection is retired"
          : bundle.error_detail;
      transaction.run(
        `INSERT INTO forgejo_finding_feedback (
           finding_id, evaluation_id, publication_status,
           path, side, start_line, start_side, line,
           error_code, error_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        finding.id,
        bundle.evaluation_id,
        coordinate
          ? unavailable
            ? "unavailable"
            : "waiting"
          : "aggregate_only",
        coordinate?.path ?? null,
        coordinate?.side ?? null,
        coordinate?.start_line ?? null,
        coordinate?.start_side ?? null,
        coordinate?.line ?? null,
        unavailable ? bundle.error_code : null,
        unavailable ? errorDetail : null,
      );
    }
  });
}
