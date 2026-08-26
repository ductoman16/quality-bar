import { normalizePublicRepositoryUrl } from "./repository/repository-validation.ts";

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function requireGrant(grant: unknown) {
  if (
    !grant ||
    typeof grant !== "object" ||
    typeof (grant as { repository_url?: unknown }).repository_url !== "string"
  ) {
    fail("authentication_invalid", "Onboarding authentication is invalid");
  }
  return grant as { repository_url: string };
}

export function createOnboardingOperations({
  evaluations,
  onboardingTokens,
  repositories,
  repositoryGuidance,
  reviews,
}: any) {
  function repository(grant: unknown) {
    return (
      repositories.listPage({
        remoteUrl: requireGrant(grant).repository_url,
      }).items[0] ?? null
    );
  }

  function requireRepository(grant: unknown, repositoryId: string) {
    const current = repository(grant);
    if (!current || current.id !== repositoryId) {
      fail("repository_not_found", "Repository was not found");
    }
    return current;
  }

  function requireEvaluation(grant: unknown, evaluationId: string) {
    const evaluation = evaluations.read(evaluationId);
    if (evaluation.repository.url !== requireGrant(grant).repository_url) {
      fail("evaluation_not_found", "Evaluation was not found");
    }
    return evaluation;
  }

  function requireEditableReview(grant: unknown, reviewId: string) {
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
    createReview(grant: unknown, repositoryId: string, body: unknown) {
      requireRepository(grant, repositoryId);
      return reviews.createForRepository(repositoryId, body);
    },
    async createEvaluation(
      grant: unknown,
      repositoryId: string,
      request: unknown,
      idempotencyKey: unknown,
      channel: "implementer_token" | "mcp",
    ) {
      requireRepository(grant, repositoryId);
      return evaluations.createExplicit({
        channel,
        idempotencyKey,
        repositoryId,
        request,
      });
    },
    guidance(grant: unknown, repositoryId: string) {
      requireRepository(grant, repositoryId);
      return repositoryGuidance.read(repositoryId);
    },
    listRepositories(grant: unknown) {
      const page = repositories.listPage({
        remoteUrl: requireGrant(grant).repository_url,
      });
      return page;
    },
    listReviews() {
      return { reviews: reviews.list("active") };
    },
    readEvaluation(grant: unknown, evaluationId: string) {
      return requireEvaluation(grant, evaluationId);
    },
    readEvaluationResult(grant: unknown, evaluationId: string) {
      requireEvaluation(grant, evaluationId);
      return evaluations.readResult(evaluationId);
    },
    async registerRepository(grant: unknown, body: unknown) {
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
    revoke(grant: unknown, token: unknown) {
      requireGrant(grant);
      onboardingTokens.selfRevoke(token);
    },
    saveReviewVersion(grant: unknown, reviewId: string, body: unknown) {
      requireEditableReview(grant, reviewId);
      return reviews.saveVersion(reviewId, body);
    },
    setReviews(grant: unknown, repositoryId: string, body: unknown) {
      requireRepository(grant, repositoryId);
      return reviews.setForRepository(repositoryId, body);
    },
    updateReviewMetadata(grant: unknown, reviewId: string, body: unknown) {
      requireEditableReview(grant, reviewId);
      return reviews.updateMetadata(reviewId, body);
    },
  };
}
