import { DatabaseSync } from "node:sqlite";

import { initializeOrValidateSchema } from "../durable/durable-schema.js";

/** @param {unknown} sql */
function normalizedSql(sql) {
  if (typeof sql !== "string") {
    return sql;
  }
  /** @type {string[]} */
  const tokens = [];
  let token = "";
  let quoteEnd;
  const pushToken = () => {
    if (token) {
      tokens.push(token);
      token = "";
    }
  };
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoteEnd) {
      token += character;
      if (character === quoteEnd) {
        if (sql[index + 1] === quoteEnd && quoteEnd !== "]") {
          token += sql[++index];
        } else {
          quoteEnd = undefined;
          pushToken();
        }
      }
    } else if (character === "'" || character === '"' || character === "`") {
      pushToken();
      quoteEnd = character;
      token = character;
    } else if (character === "[") {
      pushToken();
      quoteEnd = "]";
      token = character;
    } else if (/\s/.test(character)) {
      pushToken();
    } else if ("[](),;.=<>+-*/%|&~".includes(character)) {
      pushToken();
      tokens.push(character);
    } else {
      token += character;
    }
  }
  pushToken();
  return tokens
    .filter(
      (value, index) =>
        !(
          value.toUpperCase() === "IF" &&
          tokens[index + 1]?.toUpperCase() === "NOT" &&
          tokens[index + 2]?.toUpperCase() === "EXISTS"
        ) &&
        !(
          index > 0 &&
          tokens[index - 1]?.toUpperCase() === "IF" &&
          ["NOT", "EXISTS"].includes(value.toUpperCase())
        ) &&
        !(
          index > 1 &&
          tokens[index - 2]?.toUpperCase() === "IF" &&
          tokens[index - 1]?.toUpperCase() === "NOT" &&
          value.toUpperCase() === "EXISTS"
        ),
    )
    .join(" ");
}

/** @param {string} sql */
function tableDefinitions(sql) {
  const opening = sql.indexOf("(");
  if (opening < 0) {
    return [];
  }
  const definitions = [];
  let definitionStart = opening + 1;
  let depth = 0;
  let quoteEnd;
  for (let index = opening + 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (quoteEnd) {
      if (character === quoteEnd) {
        if (sql[index + 1] === quoteEnd && quoteEnd !== "]") {
          index += 1;
        } else {
          quoteEnd = undefined;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quoteEnd = character;
    } else if (character === "[") {
      quoteEnd = "]";
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && depth > 0) {
      depth -= 1;
    } else if (
      (character === "," && depth === 0) ||
      (character === ")" && depth === 0)
    ) {
      definitions.push(normalizedSql(sql.slice(definitionStart, index)));
      definitionStart = index + 1;
      if (character === ")") {
        break;
      }
    }
  }
  return definitions.sort();
}

/** @param {DatabaseSync} database @param {string} tableName */
function foreignKeys(database, tableName) {
  /** @type {Map<unknown, Array<Record<string, any>>>} */
  const groups = new Map();
  for (const row of database
    .prepare("SELECT * FROM pragma_foreign_key_list(?)")
    .all(tableName)) {
    const { id, ...definition } = row;
    const group = groups.get(id) ?? [];
    group.push(definition);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => group.sort((left, right) => left.seq - right.seq))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

/** @param {DatabaseSync} database @param {string} tableName */
function indexes(database, tableName) {
  return database
    .prepare('SELECT name, "unique", origin, partial FROM pragma_index_list(?)')
    .all(tableName)
    .map((index) => ({
      name: index.origin === "c" ? index.name : undefined,
      unique: index.unique,
      origin: index.origin,
      partial: index.partial,
      columns: database
        .prepare(
          `SELECT seqno, cid, name, desc, coll, key
             FROM pragma_index_xinfo(?)
            ORDER BY seqno`,
        )
        .all(index.name),
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

/** @param {DatabaseSync} database */
export function schemaDefinition(database) {
  const objects = database
    .prepare(
      `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
        WHERE type != 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name`,
    )
    .all()
    .map((row) => ({ ...row, sql: normalizedSql(row.sql) }));
  const tables = database
    .prepare(
      `SELECT name, sql
         FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all()
    .map((table) => {
      const sql = String(table.sql);
      return {
        name: table.name,
        definitions: tableDefinitions(sql),
        columns: database
          .prepare(
            `SELECT name, type, "notnull", dflt_value, pk, hidden
               FROM pragma_table_xinfo(?)
              ORDER BY name`,
          )
          .all(table.name),
        foreignKeys: foreignKeys(database, String(table.name)),
        indexes: indexes(database, String(table.name)),
        strict: /\)\s*STRICT$/i.test(sql),
        withoutRowid: /\)\s*WITHOUT ROWID/i.test(sql),
      };
    });
  return { objects, tables };
}

function currentSchemaDefinition() {
  const database = new DatabaseSync(":memory:");
  try {
    initializeOrValidateSchema(database);
    return JSON.stringify(schemaDefinition(database));
  } finally {
    database.close();
  }
}

export const CURRENT_SCHEMA_DEFINITION = currentSchemaDefinition();
