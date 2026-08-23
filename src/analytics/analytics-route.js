import { requireCodedError } from "../coded-error.js";
import { isUnavailableError } from "../http-request.js";
import { writeError, writeJson } from "../http-response.js";
import { validatedAnalyticsFilters } from "./analytics-filter.js";

/** @param {string} value */
function exactUnsignedDecimal(value) {
  return /^(0|[1-9]\d*)$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * @param {import("fastify").FastifyReply} response
 * @param {{read: (filters?: Record<string, unknown>) => unknown}} analytics
 * @param {Record<string, unknown>} query
 */
export function writeAnalytics(response, analytics, query) {
  try {
    const filters = validatedAnalyticsFilters(
      Object.fromEntries(
        Object.entries(query).map(([name, value]) => [
          name,
          ["end", "pull_request_number", "start"].includes(name)
            ? exactUnsignedDecimal(String(value))
            : value,
        ]),
      ),
    );
    writeJson(response, 200, analytics.read(filters));
  } catch (error) {
    const failure = requireCodedError(error);
    writeError(
      response,
      failure.code === "analytics_filter_invalid"
        ? 400
        : isUnavailableError(failure)
          ? 503
          : 500,
      failure.code,
      failure.message,
    );
  }
}
