import { readPollingProvider } from "./system-polling-provider-facts.js";

/** @param {any} durableCore @returns {any[]} */
export function readSystemPollingFacts(durableCore) {
  return [
    ...readPollingProvider(durableCore, "github"),
    ...readPollingProvider(durableCore, "forgejo"),
  ].sort((left, right) =>
    `${left.provider}:${left.connection_id}`.localeCompare(
      `${right.provider}:${right.connection_id}`,
    ),
  );
}
