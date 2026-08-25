import { createReviewService } from "./review.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const create = deps.createReviews ?? createReviewService;
  const reviews = create(deps.durableCore, { now: deps.now });
  return { reviews };
}
