import { createReviewService } from "./review.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create = deps.createReviews ?? createReviewService;
  const reviews = create(deps.durableCore, { now: deps.now });
  return { reviews };
}
