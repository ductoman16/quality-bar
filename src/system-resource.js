import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { insertAuthorityAttribution } from "./authority-attribution.js";
import { readCodexCapabilityCatalog } from "./codex-capabilities.js";
import { readSystemCodexExecutionFacts } from "./system-execution-facts.js";
import { readSystemPollingDeliveryFacts } from "./system-polling-delivery-facts.js";
import { readSystemStorageFacts } from "./system-storage-facts.js";
import { BACKUPS_PATH } from "./installation-environment.js";
import {
  BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
  BROWSER_SESSION_IDLE_LIFETIME_MS,
} from "./browser-session.js";

const DEFAULT_PAGE_SIZE = 50;

/** @param {string} code */
function invalidQuery(code) {
  return Object.assign(new Error(code), { code });
}

/** @param {number} timestamp */
function timestampToUtc(timestamp) {
  return new Date(timestamp).toISOString();
}

/** @param {string | undefined} value */
function pageSize(value) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) {
    throw invalidQuery("page_size_invalid");
  }
  return Number(value);
}

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   error_code: string | null,
 *   id: string,
 *   occurred_at: number,
 *   outcome: string
 * }} AuthorityAttributionRow
 */
/** @param {AuthorityAttributionRow} row */
function eventDocument(row) {
  const document = /** @type {{
   *   action: string,
   *   channel: string,
   *   error_code?: string,
   *   id: string,
   *   occurred_at: string,
   *   outcome: string
   * }} */ ({
    action: row.action,
    channel: row.channel,
    id: row.id,
    occurred_at: timestampToUtc(row.occurred_at),
    outcome: row.outcome,
  });
  if (row.error_code !== null) {
    document.error_code = row.error_code;
  }
  return document;
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {{
 *   applicationVersion?: string,
 *   backupsPath?: string,
 *   installationKeyIdentity?: string,
 *   now?: () => number,
 *   readBackups?: typeof import("./validated-backup.js").readValidatedBackups
 * }} [options]
 */
export function createSystemResource(
  durableCore,
  {
    applicationVersion,
    backupsPath = BACKUPS_PATH,
    installationKeyIdentity,
    now = () => Date.now(),
    readBackups,
  } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  const cursorKey = randomBytes(32);

  /** @param {AuthorityAttributionRow} row */
  function encodeCursor(row) {
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

  /** @param {string} cursor */
  function decodeCursor(cursor) {
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
      const boundary = /** @type {unknown} */ (
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "base64url")),
            decipher.final(),
          ]).toString("utf8"),
        )
      );
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
    /** @param {Omit<import("./authority-attribution.js").AuthorityAttribution, "occurredAt">} event */
    recordAuthorityAttribution(event) {
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
    /**
     * @param {{
     *   browserSessions: { isBootstrapped: () => boolean },
     *   codex: { error?: string, status: string },
     *   implementerToken: { status: string },
     *   storage: unknown
     * }} facts
     */
    readFacts({ browserSessions, codex, implementerToken, storage }) {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError(
          "now must return a nonnegative integer millisecond timestamp",
        );
      }
      const storageFacts = readSystemStorageFacts({
        applicationVersion,
        backupsPath,
        durableCore,
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
          active_count: /** @type {{ count: number }} */ (
            durableCore.get(
              `SELECT COUNT(*) AS count
               FROM browser_sessions
              WHERE created_at > ? AND last_authenticated_at > ?`,
              timestamp - BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
              timestamp - BROWSER_SESSION_IDLE_LIFETIME_MS,
            )
          ).count,
          status: "available",
        },
        codex: {
          ...codex,
          catalog: readCodexCapabilityCatalog(),
        },
        codex_execution: readSystemCodexExecutionFacts(durableCore, {
          codex,
          now: timestamp,
          storage: /** @type {{status?: string}} */ (storage),
        }),
        ...readSystemPollingDeliveryFacts(durableCore, {
          now: () => timestamp,
        }),
        durable_core: {
          database_version: durableCore.facts.databaseVersion,
          foreign_keys: durableCore.facts.foreignKeys,
          integrity: durableCore.facts.integrity,
          journal_mode: durableCore.facts.journalMode,
          schema_version: durableCore.facts.schemaVersion,
          schema_version_before_migration:
            durableCore.facts.schemaVersionBeforeMigration,
          status: "ready",
          synchronous: durableCore.facts.synchronous,
        },
        implementer_token: implementerToken,
        storage,
      };
    },
    /** @param {{ cursor?: string, limit?: string }} query */
    listAuthorityAttributions({ cursor, limit } = {}) {
      const size = pageSize(limit);
      const boundary = cursor === undefined ? null : decodeCursor(cursor);
      const rows = /** @type {AuthorityAttributionRow[] | null} */ (
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
      );
      const pageRows =
        rows ??
        /** @type {AuthorityAttributionRow[]} */ (
          durableCore.all(
            `SELECT id, channel, action, outcome, error_code, occurred_at
           FROM authority_attributions
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
            size + 1,
          )
        );
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
