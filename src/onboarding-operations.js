import { normalizePublicRepositoryUrl } from "./repository-validation.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {unknown} grant */
function requireGrant(grant) {
  if (
    !grant ||
    typeof grant !== "object" ||
    typeof (
      /** @type {{repository_url?: unknown}} */ (grant).repository_url
    ) !== "string"
  ) {
    fail("authentication_invalid", "Onboarding authentication is invalid");
  }
  return /** @type {{repository_url: string}} */ (grant);
}

/** @param {any} dependencies */
export function createOnboardingOperations({
  evaluations,
  onboardingTokens,
  repositories,
  repositoryGuidance,
  reviews,
}) {
  /** @param {unknown} grant */
  function repository(grant) {
    return (
      repositories.listPage({
        remoteUrl: requireGrant(grant).repository_url,
      }).items[0] ?? null
    );
  }

  /** @param {unknown} grant @param {string} repositoryId */
  function requireRepository(grant, repositoryId) {
    const current = repository(grant);
    if (!current || current.id !== repositoryId) {
      fail("repository_not_found", "Repository was not found");
    }
    return current;
  }

  /** @param {unknown} grant @param {string} evaluationId */
  function requireEvaluation(grant, evaluationId) {
    const evaluation = evaluations.read(evaluationId);
    if (evaluation.repository.url !== requireGrant(grant).repository_url) {
      fail("evaluation_not_found", "Evaluation was not found");
    }
    return evaluation;
  }

  /** @param {unknown} grant @param {string} reviewId */
  function requireEditableReview(grant, reviewId) {
    const currentRepository = repository(grant);
    const review = reviews.read(reviewId);
    if (
      !currentRepository ||
      review.assignment.scope !== "repository_set" ||
      review.assignment.repository_ids.length !== 1 ||
      review.assignment.repository_ids[0] !== currentRepository.id
    ) {
      fail("review_not_found", "Review was not found");
    }
  }

  return {
    /** @param {unknown} grant @param {string} repositoryId @param {unknown} body */
    createReview(grant, repositoryId, body) {
      requireRepository(grant, repositoryId);
      return reviews.createForRepository(repositoryId, body);
    },
    /** @param {unknown} grant @param {string} repositoryId @param {unknown} request @param {unknown} idempotencyKey @param {"implementer_token" | "mcp"} channel */
    async createEvaluation(
      grant,
      repositoryId,
      request,
      idempotencyKey,
      channel,
    ) {
      requireRepository(grant, repositoryId);
      return evaluations.createExplicit({
        channel,
        idempotencyKey,
        repositoryId,
        request,
      });
    },
    /** @param {unknown} grant @param {string} repositoryId */
    guidance(grant, repositoryId) {
      requireRepository(grant, repositoryId);
      return repositoryGuidance.read(repositoryId);
    },
    /** @param {unknown} grant */
    listRepositories(grant) {
      const page = repositories.listPage({
        remoteUrl: requireGrant(grant).repository_url,
      });
      return { ...page, repositories: page.items };
    },
    listReviews() {
      return { reviews: reviews.list("active") };
    },
    /** @param {unknown} grant @param {string} evaluationId */
    readEvaluation(grant, evaluationId) {
      return requireEvaluation(grant, evaluationId);
    },
    /** @param {unknown} grant @param {string} evaluationId */
    readEvaluationResult(grant, evaluationId) {
      requireEvaluation(grant, evaluationId);
      return evaluations.readResult(evaluationId);
    },
    /** @param {unknown} grant @param {unknown} body */
    async registerRepository(grant, body) {
      const target = requireGrant(grant).repository_url;
      const normalized = normalizePublicRepositoryUrl(body);
      if (normalized !== target) {
        fail(
          "repository_url_mismatch",
          "Repository URL does not match the onboarding token",
        );
      }
      return repositories.register({ url: normalized });
    },
    /** @param {unknown} grant @param {unknown} token */
    revoke(grant, token) {
      requireGrant(grant);
      onboardingTokens.selfRevoke(token);
    },
    /** @param {unknown} grant @param {string} reviewId @param {unknown} body */
    saveReviewVersion(grant, reviewId, body) {
      requireEditableReview(grant, reviewId);
      return reviews.saveVersion(reviewId, body);
    },
    /** @param {unknown} grant @param {string} repositoryId @param {unknown} body */
    setReviews(grant, repositoryId, body) {
      requireRepository(grant, repositoryId);
      return reviews.setForRepository(repositoryId, body);
    },
    /** @param {unknown} grant @param {string} reviewId @param {unknown} body */
    updateReviewMetadata(grant, reviewId, body) {
      requireEditableReview(grant, reviewId);
      return reviews.updateMetadata(reviewId, body);
    },
  };
}
