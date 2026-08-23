import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 100;
const CURSOR_PURPOSE = "quality-bar/repository-collection-cursor/v1";

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
      "Repository collection limit must be between 1 and 100",
    );
  }
  return Number(value);
}

/**
 * @typedef {{
 *   id: string,
 *   url: string
 * }} RepositoryCursorBoundary
 */

/**
 * @template {{id: string, url: string}} Repository
 * @param {Buffer} masterKey
 * @param {(query: {after: RepositoryCursorBoundary | null, limit: number}) => Repository[]} readPage
 */
export function createRepositoryCollection(masterKey, readPage) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("Repository collection master key must be 32 bytes");
  }
  if (typeof readPage !== "function") {
    throw new TypeError("Repository collection readPage must be a function");
  }
  const cursorKey = createHmac("sha256", masterKey)
    .update(CURSOR_PURPOSE)
    .digest();

  /** @param {RepositoryCursorBoundary} boundary */
  function encodeCursor(boundary) {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      cursorKey,
      initializationVector,
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(boundary), "utf8"),
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
      throw invalidQuery(
        "cursor_invalid",
        "Repository collection cursor is invalid",
      );
    }
    try {
      const [iv, tag, ciphertext, extra] = cursor.split(".");
      if (
        !iv ||
        !tag ||
        !ciphertext ||
        extra !== undefined ||
        ![iv, tag, ciphertext].every((part) => /^[A-Za-z0-9_-]+$/.test(part))
      ) {
        throw invalidQuery(
          "cursor_invalid",
          "Repository collection cursor is invalid",
        );
      }
      const initializationVector = Buffer.from(iv, "base64url");
      const authenticationTag = Buffer.from(tag, "base64url");
      if (
        initializationVector.length !== 12 ||
        authenticationTag.length !== 16 ||
        initializationVector.toString("base64url") !== iv ||
        authenticationTag.toString("base64url") !== tag ||
        Buffer.from(ciphertext, "base64url").toString("base64url") !==
          ciphertext
      ) {
        throw invalidQuery(
          "cursor_invalid",
          "Repository collection cursor is invalid",
        );
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        cursorKey,
        initializationVector,
      );
      decipher.setAuthTag(authenticationTag);
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
        !("url" in boundary) ||
        typeof boundary.id !== "string" ||
        boundary.id.length === 0 ||
        typeof boundary.url !== "string" ||
        boundary.url.length === 0 ||
        Object.keys(boundary).length !== 2
      ) {
        throw invalidQuery(
          "cursor_invalid",
          "Repository collection cursor is invalid",
        );
      }
      return { id: boundary.id, url: boundary.url };
    } catch (error) {
      throw error instanceof Error &&
        "code" in error &&
        error.code === "cursor_invalid"
        ? error
        : invalidQuery(
            "cursor_invalid",
            "Repository collection cursor is invalid",
          );
    }
  }

  return {
    /**
     * @param {{cursor?: string, limit?: string}} [query]
     */
    read({ cursor, limit } = {}) {
      const size = pageSize(limit);
      const page = readPage({
        after: cursor === undefined ? null : decodeCursor(cursor),
        limit: size + 1,
      });
      if (!Array.isArray(page) || page.length > size + 1) {
        throw new TypeError("Repository collection page is invalid");
      }
      for (const repository of page) {
        if (
          !repository ||
          typeof repository.id !== "string" ||
          repository.id.length === 0 ||
          typeof repository.url !== "string" ||
          repository.url.length === 0
        ) {
          throw new TypeError("Repository collection item is invalid");
        }
      }
      const hasMore = page.length > size;
      const items = page.slice(0, size);
      const lastItem = items.at(-1);
      return {
        items,
        next_cursor:
          hasMore && lastItem
            ? encodeCursor({ id: lastItem.id, url: lastItem.url })
            : null,
      };
    },
    destroy() {
      cursorKey.fill(0);
    },
  };
}
