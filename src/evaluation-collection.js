import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 100;
const CURSOR_PURPOSE = "quality-bar/evaluation-cursor/v1";

/** @param {string} code @param {string} message */
function invalidQuery(code, message) {
  return Object.assign(new Error(message), { code });
}

/** @param {string | undefined} value */
function pageSize(value) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > MAXIMUM_PAGE_SIZE) {
    throw invalidQuery(
      "page_size_invalid",
      "Evaluation collection limit must be between 1 and 100",
    );
  }
  return Number(value);
}

/** @typedef {{created_at: number, id: string}} EvaluationCursorBoundary */

/**
 * @param {Buffer} masterKey
 * @param {(query: {
 *   after: EvaluationCursorBoundary | null,
 *   limit: number
 * }) => (Record<string, import("node:sqlite").SQLInputValue> | undefined)[]} readPage
 */
export function createEvaluationCollection(masterKey, readPage) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("Evaluation collection master key must be 32 bytes");
  }
  if (typeof readPage !== "function") {
    throw new TypeError("Evaluation collection readPage must be a function");
  }
  const cursorKey = createHmac("sha256", masterKey)
    .update(CURSOR_PURPOSE)
    .digest();

  /** @param {EvaluationCursorBoundary} boundary */
  function encodeCursor(boundary) {
    const body = Buffer.from(JSON.stringify(boundary)).toString("base64url");
    const signature = createHmac("sha256", cursorKey)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  /** @param {string} cursor */
  function decodeCursor(cursor) {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (
        !body ||
        !signature ||
        extra !== undefined ||
        !/^[A-Za-z0-9_-]+$/.test(body) ||
        !/^[A-Za-z0-9_-]+$/.test(signature)
      ) {
        throw new Error("invalid cursor");
      }
      const expected = createHmac("sha256", cursorKey).update(body).digest();
      const actual = Buffer.from(signature, "base64url");
      if (
        actual.length !== expected.length ||
        actual.toString("base64url") !== signature ||
        !timingSafeEqual(actual, expected)
      ) {
        throw new Error("invalid cursor");
      }
      const boundary = /** @type {unknown} */ (
        JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
      );
      if (
        !boundary ||
        Array.isArray(boundary) ||
        typeof boundary !== "object" ||
        !("created_at" in boundary) ||
        !("id" in boundary) ||
        !Number.isSafeInteger(boundary.created_at) ||
        typeof boundary.id !== "string" ||
        boundary.id.length === 0 ||
        Object.keys(boundary).length !== 2
      ) {
        throw new Error("invalid cursor");
      }
      return {
        created_at: /** @type {number} */ (boundary.created_at),
        id: boundary.id,
      };
    } catch {
      throw invalidQuery(
        "cursor_invalid",
        "Evaluation collection cursor is invalid",
      );
    }
  }

  return {
    /** @param {{cursor?: string, limit?: string}} [query] */
    read({ cursor, limit } = {}) {
      const size = pageSize(limit);
      const rows = readPage({
        after: cursor === undefined ? null : decodeCursor(cursor),
        limit: size + 1,
      });
      if (!Array.isArray(rows) || rows.length > size + 1) {
        throw new TypeError("Evaluation collection page is invalid");
      }
      for (const row of rows) {
        if (
          !row ||
          typeof row.id !== "string" ||
          row.id.length === 0 ||
          !Number.isSafeInteger(row.created_at)
        ) {
          throw new TypeError("Evaluation collection row is invalid");
        }
      }
      const hasMore = rows.length > size;
      const items = rows.slice(0, size);
      const last = items.at(-1);
      return {
        items,
        next_cursor:
          hasMore && last
            ? encodeCursor({
                created_at: /** @type {number} */ (last.created_at),
                id: /** @type {string} */ (last.id),
              })
            : null,
      };
    },
  };
}
