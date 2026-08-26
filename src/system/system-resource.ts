import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { insertAuthorityAttribution } from "../authority-attribution.ts";
import { readCodexCapabilityCatalog } from "../codex/codex-capabilities.ts";
import { readSystemCodexExecutionFacts } from "./system-execution-facts.ts";
import { readSystemPollingDeliveryFacts } from "./system-polling-delivery-facts.ts";
import { readSystemStorageFacts } from "./system-storage-facts.ts";
import { BACKUPS_PATH } from "../installation-environment.ts";
import {
  BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
  BROWSER_SESSION_IDLE_LIFETIME_MS,
} from "../browser-session.ts";

const DEFAULT_PAGE_SIZE = 50;

function executionProviders(codex: { error?: string; status: string }) {
  const provider = {
    id: "codex",
    name: "Codex",
    status: codex.status,
  };
  if (codex.status === "unavailable") {
    if (codex.error !== "codex_authentication_unavailable") {
      throw new Error("execution_provider_failure_unsupported");
    }
    return [
      {
        ...provider,
        error: {
          code: codex.error,
          message: "Codex is not signed in for this Quality Bar installation.",
          recovery:
            "Run `docker compose run --rm --no-deps quality-bar codex login --device-auth` from the Quality Bar installation directory, then restart Quality Bar.",
        },
      },
    ];
  }
  return [provider];
}

function invalidQuery(code: string) {
  return Object.assign(new Error(code), { code });
}

function timestampToUtc(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function pageSize(value: string | undefined) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) {
    throw invalidQuery("page_size_invalid");
  }
  return Number(value);
}

export type AuthorityAttributionRow = {
  action: string;
  channel: string;
  error_code: string | null;
  id: string;
  occurred_at: number;
  outcome: string;
};
function eventDocument(row: AuthorityAttributionRow) {
  const document = {
    action: row.action,
    channel: row.channel,
    id: row.id,
    occurred_at: timestampToUtc(row.occurred_at),
    outcome: row.outcome,
  } as {
    action: string;
    channel: string;
    error_code?: string;
    id: string;
    occurred_at: string;
    outcome: string;
  };
  if (row.error_code !== null) {
    document.error_code = row.error_code;
  }
  return document;
}

export function createSystemResource(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  {
    applicationVersion,
    backupsPath = BACKUPS_PATH,
    installationKeyIdentity,
    now = () => Date.now(),
    readBackups,
  }: {
    applicationVersion?: string;
    backupsPath?: string;
    installationKeyIdentity?: string;
    now?: () => number;
    readBackups?: typeof import("../validated-backup.ts").readValidatedBackups;
  } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  const cursorKey = randomBytes(32);

  function encodeCursor(row: AuthorityAttributionRow) {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      cursorKey,
      initializationVector,
    );
    const ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify({ id: row.id, occurred_at: row.occurred_at }),
        "utf8",
      ),
      cipher.final(),
    ]);
    return [
      initializationVector.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  function decodeCursor(cursor: string) {
    if (typeof cursor !== "string" || cursor.length === 0) {
      throw invalidQuery("cursor_invalid");
    }
    try {
      const [iv, tag, ciphertext, extra] = cursor.split(".");
      if (!iv || !tag || !ciphertext || extra !== undefined) {
        throw invalidQuery("cursor_invalid");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        cursorKey,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const boundary = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as unknown;
      if (
        !boundary ||
        Array.isArray(boundary) ||
        typeof boundary !== "object" ||
        !("id" in boundary) ||
        !("occurred_at" in boundary) ||
        typeof boundary.id !== "string" ||
        typeof boundary.occurred_at !== "number" ||
        !Number.isSafeInteger(boundary.occurred_at) ||
        boundary.occurred_at < 0 ||
        Object.keys(boundary).length !== 2
      ) {
        throw invalidQuery("cursor_invalid");
      }
      return { id: boundary.id, occurred_at: boundary.occurred_at };
    } catch (error) {
      throw error instanceof Error &&
        "code" in error &&
        error.code === "cursor_invalid"
        ? error
        : invalidQuery("cursor_invalid");
    }
  }

  return {
    recordAuthorityAttribution(
      event: Omit<
        import("../authority-attribution.ts").AuthorityAttribution,
        "occurredAt"
      >,
    ) {
      const occurredAt = now();
      if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
        throw new TypeError(
          "now must return a nonnegative integer millisecond timestamp",
        );
      }
      durableCore.transaction((transaction) => {
        insertAuthorityAttribution(transaction, { ...event, occurredAt });
      });
    },
    readFacts({
      browserSessions,
      codex,
      implementerToken,
      storage,
    }: {
      browserSessions: { isBootstrapped: () => boolean };
      codex: { error?: string; status: string };
      implementerToken: { status: string };
      storage: unknown;
    }) {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError(
          "now must return a nonnegative integer millisecond timestamp",
        );
      }
      const storageFacts = readSystemStorageFacts({
        applicationVersion,
        backupsPath,
        installationKeyIdentity,
        now: () => timestamp,
        readBackups,
      });
      return {
        ...storageFacts,
        bootstrap: {
          status: browserSessions.isBootstrapped() ? "complete" : "required",
        },
        browser_sessions: {
          active_count: (
            durableCore.get(
              `SELECT COUNT(*) AS count
               FROM browser_sessions
              WHERE created_at > ? AND last_authenticated_at > ?`,
              timestamp - BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
              timestamp - BROWSER_SESSION_IDLE_LIFETIME_MS,
            ) as { count: number }
          ).count,
          status: "available",
        },
        codex: {
          ...codex,
          catalog: readCodexCapabilityCatalog(),
        },
        execution_providers: executionProviders(codex),
        codex_execution: readSystemCodexExecutionFacts(durableCore, {
          codex,
          now: timestamp,
          storage: storage as { status?: string },
        }),
        ...readSystemPollingDeliveryFacts(durableCore, {
          now: () => timestamp,
        }),
        durable_core: {
          database_version: durableCore.facts.databaseVersion,
          foreign_keys: durableCore.facts.foreignKeys,
          integrity: durableCore.facts.integrity,
          journal_mode: durableCore.facts.journalMode,
          status: "ready",
          synchronous: durableCore.facts.synchronous,
        },
        implementer_token: implementerToken,
        storage,
      };
    },
    listAuthorityAttributions({
      cursor,
      limit,
    }: { cursor?: string; limit?: string } = {}) {
      const size = pageSize(limit);
      const boundary = cursor === undefined ? null : decodeCursor(cursor);
      const rows = (
        boundary
          ? durableCore.all(
              `SELECT id, channel, action, outcome, error_code, occurred_at
                 FROM authority_attributions
                WHERE occurred_at < ? OR (occurred_at = ? AND id < ?)
                ORDER BY occurred_at DESC, id DESC
                LIMIT ?`,
              boundary.occurred_at,
              boundary.occurred_at,
              boundary.id,
              size + 1,
            )
          : null
      ) as AuthorityAttributionRow[] | null;
      const pageRows =
        rows ??
        (durableCore.all(
          `SELECT id, channel, action, outcome, error_code, occurred_at
           FROM authority_attributions
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
          size + 1,
        ) as AuthorityAttributionRow[]);
      const hasMore = pageRows.length > size;
      const items = pageRows.slice(0, size);
      const lastItem = items.at(-1);
      return {
        items: items.map(eventDocument),
        next_cursor: hasMore && lastItem ? encodeCursor(lastItem) : null,
      };
    },
  };
}
