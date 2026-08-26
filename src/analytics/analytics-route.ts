import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson } from "../http-response.ts";
import { validatedAnalyticsFilters } from "./analytics-filter.ts";

function exactUnsignedDecimal(value: string) {
  return /^(0|[1-9]\d*)$/.test(value) ? Number(value) : Number.NaN;
}

export function writeAnalytics(
  response: import("fastify").FastifyReply,
  analytics: { read: (filters?: Record<string, unknown>) => unknown },
  query: Record<string, unknown>,
) {
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
