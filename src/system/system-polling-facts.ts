import { readPollingProvider } from "./system-polling-provider-facts.ts";

export function readSystemPollingFacts(durableCore: any): any[] {
  return [
    ...readPollingProvider(durableCore, "github"),
    ...readPollingProvider(durableCore, "forgejo"),
  ].sort((left, right) =>
    `${left.provider}:${left.connection_id}`.localeCompare(
      `${right.provider}:${right.connection_id}`,
    ),
  );
}
