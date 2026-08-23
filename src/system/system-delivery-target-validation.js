import { githubFeedbackSourceIdentity } from "../github/github-feedback-identity.js";

const COMMIT_STATES = new Set(["pending", "success", "failure", "error"]);

/** @param {string} provider @param {string} surface */
function invalid(provider, surface) {
  throw new TypeError(
    `${provider} System ${surface} delivery target is invalid`,
  );
}

/** @param {any} value @param {string} provider @param {string} surface */
function objectTarget(value, provider, surface) {
  if (typeof value !== "string" || value.length === 0) {
    invalid(provider, surface);
  }
  let target;
  try {
    target = JSON.parse(value);
  } catch {
    invalid(provider, surface);
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    invalid(provider, surface);
  }
  return /** @type {Record<string, any>} */ (target);
}

/** @param {Record<string, any>} target */
function keys(target) {
  return Object.keys(target).sort().join(",");
}

/** @param {unknown} value @param {any} expected */
function repositoryMatches(value, expected) {
  return (
    value === expected.repository_id ||
    (Number.isSafeInteger(value) && value === expected.forge_repository_id)
  );
}

/** @param {unknown} value @param {number} expected */
function positiveNumberMatches(value, expected) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value === expected
  );
}

/** @param {unknown} body @param {"Adjudication" | "Evaluation" | "Finding"} label @param {string} id */
function hasIdentity(body, label, id) {
  return githubFeedbackSourceIdentity(body, label) === id;
}

/** @param {unknown} value @param {string} evaluationId */
function evaluationUrlMatches(value, evaluationId) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const target = new URL(value);
    return (
      target.pathname === "/" &&
      target.hash === "" &&
      [...target.searchParams.keys()].sort().join(",") ===
        "evaluation_id,view" &&
      target.searchParams.get("view") === "evaluations" &&
      target.searchParams.get("evaluation_id") === evaluationId
    );
  } catch {
    return false;
  }
}

/** @param {Record<string, any>} target @param {any} expected @param {string} state @param {string} provider */
function validateCommitTarget(target, expected, state, provider) {
  const targetKeys = keys(target);
  const legacy = targetKeys === "context,head_commit,repository_id,state";
  const current =
    targetKeys === "context,description,head,repository_id,state,target_url";
  if (
    (!legacy && !current) ||
    target.context !== "Quality Bar" ||
    !repositoryMatches(target.repository_id, expected) ||
    target.state !== state
  ) {
    invalid(provider, "commit_status");
  }
  const head = legacy ? target.head_commit : target.head;
  if (head !== expected.head_commit) {
    invalid(provider, "commit_status");
  }
  if (current) {
    if (
      typeof target.description !== "string" ||
      !evaluationUrlMatches(target.target_url, expected.evaluation_id)
    ) {
      invalid(provider, "commit_status");
    }
  }
}

/** @param {Record<string, any>} target @param {any} expected @param {string} provider @param {string} surface */
function validateAggregateTarget(target, expected, provider, surface) {
  const targetKeys = keys(target);
  const legacy = targetKeys === "pull_request_number,repository_id";
  const current = targetKeys === "body,pull_request_number,repository_id";
  if (
    (!legacy && !current) ||
    !repositoryMatches(target.repository_id, expected) ||
    !positiveNumberMatches(
      target.pull_request_number,
      expected.pull_request_number,
    )
  ) {
    invalid(provider, surface);
  }
  if (
    current &&
    (!hasIdentity(target.body, "Evaluation", expected.evaluation_id) ||
      (expected.adjudication_id !== null &&
        !hasIdentity(target.body, "Adjudication", expected.adjudication_id)))
  ) {
    invalid(provider, surface);
  }
}

/** @param {Record<string, any>} target @param {any} expected @param {string} provider */
function validateInlineTarget(target, expected, provider) {
  const adjudicationId = expected.adjudication_id ?? null;
  const targetKeys = keys(target);
  const legacy =
    targetKeys ===
    "line,path,pull_request_number,repository_id,side,start_line,start_side";
  const reply =
    targetKeys === "body,original_comment_id,pull_request_number,repository_id";
  const current =
    targetKeys ===
      "body,commit_id,line,path,pull_request_number,repository_id,side" ||
    targetKeys ===
      "body,commit_id,line,path,pull_request_number,repository_id,side,start_line,start_side";
  if (
    (!legacy && !reply && !current) ||
    !repositoryMatches(target.repository_id, expected) ||
    !positiveNumberMatches(
      target.pull_request_number,
      expected.pull_request_number,
    )
  ) {
    invalid(provider, "inline_feedback");
  }
  if (reply) {
    if (
      !hasIdentity(target.body, "Evaluation", expected.evaluation_id) ||
      !hasIdentity(target.body, "Finding", expected.finding_id) ||
      (adjudicationId !== null &&
        !hasIdentity(target.body, "Adjudication", adjudicationId)) ||
      !positiveNumberMatches(
        target.original_comment_id,
        expected.original_external_id,
      )
    ) {
      invalid(provider, "inline_feedback");
    }
    return;
  }
  if (legacy) {
    if (adjudicationId !== null) {
      invalid(provider, "inline_feedback");
    }
    if (
      target.path !== expected.path ||
      target.side !== expected.side ||
      target.line !== expected.line ||
      (target.start_line ?? null) !== (expected.start_line ?? null) ||
      (target.start_side ?? null) !== (expected.start_side ?? null)
    ) {
      invalid(provider, "inline_feedback");
    }
    return;
  }
  if (
    !hasIdentity(target.body, "Evaluation", expected.evaluation_id) ||
    !hasIdentity(target.body, "Finding", expected.finding_id) ||
    (adjudicationId !== null &&
      !hasIdentity(target.body, "Adjudication", adjudicationId)) ||
    target.commit_id !== expected.head_commit ||
    target.path !== expected.path ||
    target.side !== expected.side ||
    target.line !== expected.line ||
    (target.start_line ?? null) !== (expected.start_line ?? null) ||
    (target.start_side ?? null) !== (expected.start_side ?? null)
  ) {
    invalid(provider, "inline_feedback");
  }
}

/** @param {any} durableCore @param {"github" | "forgejo"} provider */
export function validateSystemDeliveryTargets(durableCore, provider) {
  const attempts = durableCore.all(
    `SELECT surface, source_id, target FROM ${provider}_delivery_attempts`,
  );
  if (attempts.length === 0) {
    return;
  }
  const evaluations = new Map(
    durableCore
      .all(
        `SELECT evaluations.id AS evaluation_id, evaluations.repository_id,
                evaluations.head_commit, repositories.forge_repository_id
           FROM evaluations
           JOIN ${provider}_repositories AS repositories
             ON repositories.repository_id = evaluations.repository_id`,
      )
      .map(/** @param {any} row */ (row) => [row.evaluation_id, row]),
  );
  const automatic = new Map(
    durableCore
      .all(
        `SELECT automatic.evaluation_id,
                automatic.pull_request_number,
                repositories.forge_repository_id
           FROM ${provider}_automatic_evaluations AS automatic
           JOIN ${provider}_repositories AS repositories
             ON repositories.repository_id = automatic.repository_id`,
      )
      .map(/** @param {any} row */ (row) => [row.evaluation_id, row]),
  );
  const findings = new Map(
    durableCore
      .all(
        `SELECT feedback.finding_id, feedback.evaluation_id,
                feedback.path, feedback.side, feedback.start_line,
                feedback.start_side, feedback.line,
                automatic.pull_request_number,
                repositories.forge_repository_id
           FROM ${provider}_finding_feedback AS feedback
           JOIN ${provider}_automatic_evaluations AS automatic
             ON automatic.evaluation_id = feedback.evaluation_id
           JOIN ${provider}_repositories AS repositories
             ON repositories.repository_id = automatic.repository_id`,
      )
      .map(/** @param {any} row */ (row) => [row.finding_id, row]),
  );
  const adjudications = new Map(
    durableCore
      .all(
        `SELECT followup.waiver_adjudication_id,
                followup.evaluation_id,
                automatic.pull_request_number,
                repositories.forge_repository_id
           FROM ${provider}_waiver_adjudication_followups AS followup
           JOIN ${provider}_automatic_evaluations AS automatic
             ON automatic.evaluation_id = followup.evaluation_id
           JOIN ${provider}_repositories AS repositories
             ON repositories.repository_id = automatic.repository_id`,
      )
      .map(/** @param {any} row */ (row) => [row.waiver_adjudication_id, row]),
  );
  const decisions = new Map(
    durableCore
      .all(
        `SELECT followup.waiver_decision_id,
                followup.waiver_adjudication_id, followup.finding_id,
                followup.original_external_id,
                ${provider === "forgejo" ? "followup.path, followup.side, followup.start_line, followup.start_side, followup.line," : "NULL AS path, NULL AS side, NULL AS start_line, NULL AS start_side, NULL AS line,"}
                adjudications.evaluation_id,
                automatic.pull_request_number,
                repositories.forge_repository_id
           FROM ${provider}_waiver_decision_followups AS followup
           JOIN waiver_adjudications AS adjudications
             ON adjudications.id = followup.waiver_adjudication_id
           JOIN ${provider}_automatic_evaluations AS automatic
             ON automatic.evaluation_id = adjudications.evaluation_id
           JOIN ${provider}_repositories AS repositories
             ON repositories.repository_id = automatic.repository_id`,
      )
      .map(/** @param {any} row */ (row) => [row.waiver_decision_id, row]),
  );
  for (const attempt of attempts) {
    if (attempt?.surface === "commit_status") {
      const separator =
        typeof attempt.source_id === "string"
          ? attempt.source_id.lastIndexOf(":")
          : -1;
      const evaluationId =
        separator > 0 ? attempt.source_id.slice(0, separator) : null;
      const state =
        separator > 0 ? attempt.source_id.slice(separator + 1) : null;
      const expected =
        evaluationId === null ? null : evaluations.get(evaluationId);
      if (
        expected === undefined ||
        state === null ||
        !COMMIT_STATES.has(state)
      ) {
        invalid(provider, "commit_status");
      }
      validateCommitTarget(
        objectTarget(attempt.target, provider, "commit_status"),
        { ...expected, evaluation_id: evaluationId },
        state,
        provider,
      );
      continue;
    }
    if (attempt?.surface === "aggregate_feedback") {
      const sourceId = attempt.source_id;
      const adjudicationPrefix = "waiver-adjudication:";
      const adjudicationId =
        typeof sourceId === "string" && sourceId.startsWith(adjudicationPrefix)
          ? sourceId.slice(adjudicationPrefix.length)
          : null;
      const expected =
        adjudicationId === null
          ? automatic.has(sourceId)
            ? {
                ...evaluations.get(sourceId),
                ...automatic.get(sourceId),
                evaluation_id: sourceId,
                adjudication_id: null,
              }
            : null
          : adjudications.has(adjudicationId)
            ? {
                ...evaluations.get(
                  adjudications.get(adjudicationId).evaluation_id,
                ),
                ...adjudications.get(adjudicationId),
                evaluation_id: adjudications.get(adjudicationId).evaluation_id,
                adjudication_id: adjudicationId,
              }
            : null;
      if (expected === null || expected === undefined) {
        invalid(provider, "aggregate_feedback");
      }
      if (attempt.target === "aggregate_only") {
        invalid(provider, "aggregate_feedback");
      }
      validateAggregateTarget(
        objectTarget(attempt.target, provider, "aggregate_feedback"),
        expected,
        provider,
        "aggregate_feedback",
      );
      continue;
    }
    if (attempt?.surface === "inline_feedback") {
      const sourceId = attempt.source_id;
      const decisionPrefix = "waiver-decision:";
      const decisionParts =
        typeof sourceId === "string" && sourceId.startsWith(decisionPrefix)
          ? sourceId.slice(decisionPrefix.length).split(":")
          : [];
      const decisionId = decisionParts.length === 2 ? decisionParts[0] : null;
      const findingId =
        decisionParts.length === 2 ? decisionParts[1] : sourceId;
      const decision = decisionId === null ? null : decisions.get(decisionId);
      const finding = findings.get(findingId);
      const evaluationId = decision?.evaluation_id ?? finding?.evaluation_id;
      const evaluation =
        evaluationId === undefined ? null : evaluations.get(evaluationId);
      const automaticRow =
        evaluationId === undefined ? null : automatic.get(evaluationId);
      const expected =
        evaluation === null ||
        automaticRow === undefined ||
        finding === undefined
          ? null
          : {
              ...evaluation,
              ...automaticRow,
              ...(decision ?? {}),
              ...finding,
              evaluation_id: evaluationId,
              finding_id: findingId,
              adjudication_id: decision?.waiver_adjudication_id ?? null,
              original_external_id: decision?.original_external_id ?? null,
            };
      if (expected === null) {
        invalid(provider, "inline_feedback");
      }
      if (attempt.target === "aggregate_only") {
        invalid(provider, "inline_feedback");
      }
      validateInlineTarget(
        objectTarget(attempt.target, provider, "inline_feedback"),
        expected,
        provider,
      );
    }
  }
}
