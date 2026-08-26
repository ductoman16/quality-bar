import { validateCodexConfiguration } from "../codex/codex-capabilities.ts";

export const WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS waiver_adjudicator_configuration (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    service_tier TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
`;
const SELECT_CONFIGURATION =
  "SELECT model, reasoning_effort, service_tier, updated_at FROM waiver_adjudicator_configuration WHERE singleton = 1";

export class WaiverAdjudicatorConfigurationError extends Error {
  name: "WaiverAdjudicatorConfigurationError";
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WaiverAdjudicatorConfigurationError";
    this.code = code;
  }
}

function configurationFromRow(
  row: Record<string, import("node:sqlite").SQLInputValue> | undefined,
) {
  if (!row) {
    return null;
  }
  return validateCodexConfiguration({
    model: row.model,
    reasoning_effort: row.reasoning_effort,
    service_tier: row.service_tier,
  });
}

export function freezeWaiverAdjudicatorConfiguration(reader: {
  get(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
}) {
  let configuration;
  try {
    configuration = configurationFromRow(reader.get(SELECT_CONFIGURATION));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      (error as Error & { unavailable?: boolean }).unavailable = true;
    }
    throw error;
  }
  if (!configuration) {
    throw new WaiverAdjudicatorConfigurationError(
      "waiver_adjudicator_configuration_required",
      "Waiver Adjudicator Configuration is required",
    );
  }
  return { ...configuration };
}

export function createWaiverAdjudicatorConfigurationService(
  durableCore: {
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
    transaction<Result>(
      callback: (transaction: {
        get(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
        run(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): import("node:sqlite").StatementResultingChanges;
      }) => Result,
    ): Result;
  },
  { now = () => Date.now() }: { now?: () => number } = {},
) {
  function readConfiguration() {
    return configurationFromRow(durableCore.get(SELECT_CONFIGURATION));
  }

  return {
    read() {
      const configuration = readConfiguration();
      return configuration
        ? { configured: true, configuration }
        : { configured: false };
    },
    freezeForAdjudication() {
      return freezeWaiverAdjudicatorConfiguration(durableCore);
    },
    update(candidate: unknown) {
      const configuration = validateCodexConfiguration(candidate);
      return durableCore.transaction((transaction) => {
        const current = configurationFromRow(
          transaction.get(SELECT_CONFIGURATION),
        );
        if (
          current &&
          current.model === configuration.model &&
          current.reasoning_effort === configuration.reasoning_effort &&
          current.service_tier === configuration.service_tier
        ) {
          return { changed: false, configuration: current };
        }
        const updatedAt = now();
        if (!Number.isSafeInteger(updatedAt)) {
          throw new TypeError("now must return a safe integer timestamp");
        }
        const result = transaction.run(
          `INSERT INTO waiver_adjudicator_configuration (
             singleton,
             model,
             reasoning_effort,
             service_tier,
             updated_at
           ) VALUES (1, ?, ?, ?, ?)
           ON CONFLICT (singleton) DO UPDATE SET
             model = excluded.model,
             reasoning_effort = excluded.reasoning_effort,
             service_tier = excluded.service_tier,
             updated_at = excluded.updated_at`,
          configuration.model,
          configuration.reasoning_effort,
          configuration.service_tier,
          updatedAt,
        );
        if (result.changes !== 1) {
          throw new Error("waiver_adjudicator_configuration_change_failed");
        }
        return { changed: true, configuration };
      });
    },
  };
}
