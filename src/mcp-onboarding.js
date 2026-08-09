import {
  evaluationArguments,
  requestEvaluationArguments,
} from "./mcp-evaluation.js";
import { isMcpRecord } from "./mcp-message.js";
import {
  guidanceArguments,
  listRepositoryArguments,
} from "./mcp-repository.js";
import { isClosedMcpRecord, mcpError } from "./mcp-validation.js";

/** @param {unknown} arguments_ @param {string[]} keys */
function exact(arguments_, keys) {
  if (
    !isClosedMcpRecord(arguments_, new Set(keys)) ||
    Object.keys(arguments_).length !== keys.length
  ) {
    throw mcpError("request_malformed", "Request is malformed");
  }
  return arguments_;
}

export async function executeOnboardingTool(
  /** @type {string} */
  name,
  /** @type {unknown} */
  arguments_,
  /** @type {{
   *   grant: unknown,
   *   operations: ReturnType<typeof import("./onboarding-operations.js").createOnboardingOperations>,
   *   token: unknown
   * }} */
  { grant, operations, token },
) {
  if (name === "quality_bar.list_repositories") {
    listRepositoryArguments(arguments_);
    return operations.listRepositories(grant);
  }
  if (name === "quality_bar.list_reviews") {
    exact(arguments_, []);
    return operations.listReviews();
  }
  if (name === "quality_bar.get_repository_guidance") {
    const { repositoryId } = guidanceArguments(arguments_);
    return operations.guidance(grant, repositoryId);
  }
  if (name === "quality_bar.register_repository") {
    const input = exact(arguments_, ["url"]);
    return operations.registerRepository(grant, { url: input.url });
  }
  if (name === "quality_bar.set_repository_reviews") {
    const input = exact(arguments_, ["repository_id", "review_ids"]);
    if (typeof input.repository_id !== "string") {
      throw mcpError("request_malformed", "Request is malformed");
    }
    return operations.setReviews(grant, input.repository_id, {
      review_ids: input.review_ids,
    });
  }
  if (name === "quality_bar.create_repository_review") {
    const input = exact(arguments_, ["repository_id", "review"]);
    if (typeof input.repository_id !== "string" || !isMcpRecord(input.review)) {
      throw mcpError("request_malformed", "Request is malformed");
    }
    return operations.createReview(grant, input.repository_id, input.review);
  }
  if (name === "quality_bar.update_repository_review_metadata") {
    const input = exact(arguments_, ["review_id", "name", "description"]);
    if (typeof input.review_id !== "string") {
      throw mcpError("request_malformed", "Request is malformed");
    }
    return operations.updateReviewMetadata(grant, input.review_id, {
      name: input.name,
      description: input.description,
    });
  }
  if (name === "quality_bar.save_repository_review_version") {
    const input = exact(arguments_, ["review_id", "version"]);
    if (typeof input.review_id !== "string" || !isMcpRecord(input.version)) {
      throw mcpError("request_malformed", "Request is malformed");
    }
    return operations.saveReviewVersion(grant, input.review_id, input.version);
  }
  if (name === "quality_bar.request_evaluation") {
    const input = requestEvaluationArguments(arguments_);
    const created = await operations.createEvaluation(
      grant,
      input.repositoryId,
      input.request,
      input.idempotencyKey,
      "mcp",
    );
    return created.resource;
  }
  if (
    [
      "quality_bar.get_evaluation",
      "quality_bar.get_evaluation_result",
    ].includes(name)
  ) {
    const { evaluationId } = evaluationArguments(arguments_);
    return name.endsWith("_result")
      ? operations.readEvaluationResult(grant, evaluationId)
      : operations.readEvaluation(grant, evaluationId);
  }
  if (name === "quality_bar.revoke_onboarding_token") {
    exact(arguments_, []);
    operations.revoke(grant, token);
    return { revoked: true };
  }
  throw mcpError("request_malformed", "Unknown tool");
}
