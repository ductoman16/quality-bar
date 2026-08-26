import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 100;
const CURSOR_PURPOSE = "quality-bar/evaluation-cursor/v1";

function invalidQuery(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function pageSize(value: string | undefined) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > MAXIMUM_PAGE_SIZE) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection limit must be between 1 and 100",
    );
  }
  return Number(value);
}

export type EvaluationCursorBoundary = {
  created_at: number;
  filter_fingerprint: string;
  id: string;
};

export type EvaluationCollectionFilters = {
  effective_outcome:
    | "pending"
    | "clear"
    | "advisory"
    | "blocking"
    | "error"
    | null;
  end: number | null;
  execution_status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
  query: string | null;
  repository_id: string | null;
  start: number | null;
};

function epochMilliseconds(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  if (
    !/^(?:0|[1-9][0-9]*)$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection time filter is invalid",
    );
  }
  return Number(value);
}

function enumFilter(value: string | undefined, allowed: string[]) {
  if (value === undefined) {
    return null;
  }
  if (!allowed.includes(value)) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection filter is invalid",
    );
  }
  return value;
}

function queryFilter(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  if (value.length === 0 || value.length > 200) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection query is invalid",
    );
  }
  return value;
}

function repositoryFilter(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  if (value.length === 0) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection repository filter is invalid",
    );
  }
  return value;
}

export function readEvaluationCollectionFilters(query: {
  [key: string]: string | undefined;
}) {
  const start = epochMilliseconds(query.start);
  const end = epochMilliseconds(query.end);
  if (start !== null && end !== null && end <= start) {
    throw invalidQuery(
      "evaluation_filter_invalid",
      "Evaluation collection time window is invalid",
    );
  }
  return {
    effective_outcome: enumFilter(query.effective_outcome, [
      "pending",
      "clear",
      "advisory",
      "blocking",
      "error",
    ]) as EvaluationCollectionFilters["effective_outcome"],
    end,
    execution_status: enumFilter(query.execution_status, [
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
    ]) as EvaluationCollectionFilters["execution_status"],
    query: queryFilter(query.query),
    repository_id: repositoryFilter(query.repository_id),
    start,
  };
}

function filterFingerprint(filters: EvaluationCollectionFilters) {
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex");
}

export function createEvaluationCollection(
  masterKey: Buffer,
  readPage: (query: {
    after: EvaluationCursorBoundary | null;
    filters: EvaluationCollectionFilters;
    limit: number;
  }) => (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("Evaluation collection master key must be 32 bytes");
  }
  if (typeof readPage !== "function") {
    throw new TypeError("Evaluation collection readPage must be a function");
  }
  const cursorKey = createHmac("sha256", masterKey)
    .update(CURSOR_PURPOSE)
    .digest();

  function encodeCursor(boundary: EvaluationCursorBoundary) {
    const body = Buffer.from(JSON.stringify(boundary)).toString("base64url");
    const signature = createHmac("sha256", cursorKey)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  function decodeCursor(cursor: string, expectedFingerprint: string) {
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
      const boundary = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as unknown;
      if (
        !boundary ||
        Array.isArray(boundary) ||
        typeof boundary !== "object" ||
        !("created_at" in boundary) ||
        !("filter_fingerprint" in boundary) ||
        !("id" in boundary) ||
        !Number.isSafeInteger(boundary.created_at) ||
        typeof boundary.filter_fingerprint !== "string" ||
        boundary.filter_fingerprint !== expectedFingerprint ||
        typeof boundary.id !== "string" ||
        boundary.id.length === 0 ||
        Object.keys(boundary).length !== 3
      ) {
        throw new Error("invalid cursor");
      }
      return {
        created_at: boundary.created_at as number,
        filter_fingerprint: boundary.filter_fingerprint as string,
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
    destroy() {
      cursorKey.fill(0);
    },
    read(
      query: {
        cursor?: string;
        effective_outcome?: string;
        end?: string;
        execution_status?: string;
        limit?: string;
        query?: string;
        repository_id?: string;
        start?: string;
      } = {},
    ) {
      const filters = readEvaluationCollectionFilters(query);
      const fingerprint = filterFingerprint(filters);
      const size = pageSize(query.limit);
      const rows = readPage({
        after:
          query.cursor === undefined
            ? null
            : decodeCursor(query.cursor, fingerprint),
        filters,
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
                created_at: last.created_at as number,
                filter_fingerprint: fingerprint,
                id: last.id as string,
              })
            : null,
      };
    },
  };
}
