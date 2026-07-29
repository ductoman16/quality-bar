import { createEvaluationCollection } from "./evaluation-collection.js";
import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";
import { failEvaluation } from "./evaluation-validation.js";

/**
 * @param {{all: Function, get: Function}} durableCore
 * @param {Buffer} masterKey
 */
export function createEvaluationCollectionReader(durableCore, masterKey) {
  const collection = createEvaluationCollection(masterKey, ({ after, limit }) =>
    durableCore.all(
      `${EVALUATION_SELECTION}
         ${
           after
             ? `WHERE evaluations.created_at < ?
                  OR (
                    evaluations.created_at = ?
                    AND evaluations.id < ?
                  )`
             : ""
         }
         ORDER BY evaluations.created_at DESC, evaluations.id DESC
         LIMIT ?`,
      ...(after
        ? [after.created_at, after.created_at, after.id, limit]
        : [limit]),
    ),
  );

  /** @param {string} id */
  function read(id) {
    const row = durableCore.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      id,
    );
    if (!row) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    return readEvaluation(row);
  }

  return { collection, read };
}
