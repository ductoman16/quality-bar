import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { insertAuthorityAttribution } from "./authority-attribution.js";
import { readCodexCapabilityCatalog } from "./codex-capabilities.js";
import {
  BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
  BROWSER_SESSION_IDLE_LIFETIME_MS,
} from "./browser-session.js";

const DEFAULT_PAGE_SIZE = 50;

function invalidQuery(code) {
  return Object.assign(new Error(code), { code });
}

function timestampToUtc(timestamp) {
  return new Date(timestamp).toISOString();
}

function pageSize(value) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) {
    throw invalidQuery("page_size_invalid");
  }
  return Number(value);
}

function eventDocument(row) {
  const document = {
    action: row.action,
    channel: row.channel,
    id: row.id,
    occurred_at: timestampToUtc(row.occurred_at),
    outcome: row.outcome,
  };
  if (row.error_code !== null) {
    document.error_code = row.error_code;
  }
  return document;
}

export function createSystemResource(
  durableCore,
  { now = () => Date.now() } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  const cursorKey = randomBytes(32);

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
      const boundary = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      );
      if (
        !boundary ||
        typeof boundary.id !== "string" ||
        !Number.isSafeInteger(boundary.occurred_at) ||
        boundary.occurred_at < 0 ||
        Object.keys(boundary).length !== 2
      ) {
        throw invalidQuery("cursor_invalid");
      }
      return boundary;
    } catch (error) {
      throw error?.code === "cursor_invalid"
        ? error
        : invalidQuery("cursor_invalid");
    }
  }

  return {
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
    readFacts({ browserSessions, codex, implementerToken }) {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError(
          "now must return a nonnegative integer millisecond timestamp",
        );
      }
      return {
        bootstrap: {
          status: browserSessions.isBootstrapped() ? "complete" : "required",
        },
        browser_sessions: {
          active_count: durableCore.get(
            `SELECT COUNT(*) AS count
               FROM browser_sessions
              WHERE created_at > ? AND last_authenticated_at > ?`,
            timestamp - BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
            timestamp - BROWSER_SESSION_IDLE_LIFETIME_MS,
          ).count,
          status: "available",
        },
        codex: {
          ...codex,
          catalog: readCodexCapabilityCatalog(),
        },
        durable_core: {
          schema_version: durableCore.facts.schemaVersion,
          status: "ready",
        },
        implementer_token: implementerToken,
      };
    },
    /** @param {{ cursor?: string, limit?: string }} query */
    listAuthorityAttributions({ cursor, limit } = {}) {
      const size = pageSize(limit);
      const boundary = cursor === undefined ? null : decodeCursor(cursor);
      const rows = boundary
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
        : null;
      const pageRows =
        rows ??
        durableCore.all(
          `SELECT id, channel, action, outcome, error_code, occurred_at
           FROM authority_attributions
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
          size + 1,
        );
      const hasMore = pageRows.length > size;
      const items = pageRows.slice(0, size);
      return {
        items: items.map(eventDocument),
        next_cursor: hasMore ? encodeCursor(items.at(-1)) : null,
      };
    },
  };
}
