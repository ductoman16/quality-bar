import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { test } from "node:test";

import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

const { parse } = /** @type {{
 *   parse: (
 *     source: string,
 *     options: {ecmaVersion: "latest", loc: true, sourceType: "script"},
 *   ) => import("estree").Program,
 * }} */ (createRequire(import.meta.url)("espree"));

/** @param {any} pattern @returns {string[]} */
function bindingNames(pattern) {
  if (pattern.type === "Identifier") {
    return [pattern.name];
  }
  if (pattern.type === "RestElement") {
    return bindingNames(pattern.argument);
  }
  if (pattern.type === "AssignmentPattern") {
    return bindingNames(pattern.left);
  }
  if (pattern.type === "ArrayPattern") {
    return pattern.elements.flatMap((/** @type {any} */ element) =>
      element ? bindingNames(element) : [],
    );
  }
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((/** @type {any} */ property) =>
      property.type === "Property"
        ? bindingNames(property.value)
        : bindingNames(property.argument),
    );
  }
  return [];
}

/** @param {string} source @param {string} sourcePath */
function topLevelDeclarations(source, sourcePath) {
  const program = /** @type {any} */ (
    parse(source, {
      ecmaVersion: "latest",
      loc: true,
      sourceType: "script",
    })
  );
  const declarations = [];
  for (const statement of program.body) {
    if (
      (statement.type === "FunctionDeclaration" ||
        statement.type === "ClassDeclaration") &&
      statement.id
    ) {
      declarations.push({
        kind: statement.type,
        line: statement.loc.start.line,
        name: statement.id.name,
        sourcePath,
      });
    }
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        for (const name of bindingNames(declaration.id)) {
          declarations.push({
            kind: statement.kind,
            line: declaration.loc.start.line,
            name,
            sourcePath,
          });
        }
      }
    }
  }
  return declarations;
}

test("operator pages compile served scripts without duplicate global bindings", () => {
  for (const view of [
    "evaluations",
    "evaluation-detail",
    "reviews",
    "review-detail",
    "repositories",
    "repository-detail",
    "analytics",
    "system",
  ]) {
    const assets = [
      ...operatorPage({ view }).matchAll(
        /<script src="(\/assets\/[^"]+\.js)"><\/script>/g,
      ),
    ].map(([, path]) => path);
    assert.ok(assets.length > 0);
    const sources = assets.map((path) => readBrowserAsset(path));
    assert.doesNotThrow(
      () => new Script(sources.join("\n")),
      `${view} page scripts must compile as one classic-script bundle`,
    );
    const declarations = assets.flatMap((path, index) =>
      topLevelDeclarations(sources[index], path),
    );
    const declarationsByName = new Map();
    for (const declaration of declarations) {
      declarationsByName.set(declaration.name, [
        ...(declarationsByName.get(declaration.name) ?? []),
        declaration,
      ]);
    }
    const duplicates = [...declarationsByName].filter(
      ([, occurrences]) => occurrences.length > 1,
    );
    assert.deepEqual(
      duplicates,
      [],
      `${view} page scripts must not duplicate top-level classic-script bindings`,
    );
  }
});
