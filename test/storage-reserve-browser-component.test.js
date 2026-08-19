import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

function element() {
  return /** @type {any} */ ({
    children: [],
    hidden: true,
    textContent: "",
    /** @param {any[]} children */
    append(...children) {
      this.children.push(...children);
    },
    /** @param {any[]} children */
    replaceChildren(...children) {
      this.children = children;
    },
  });
}

test("System renders exact state and checkout reserve facts and exposes low-space attention", () => {
  const page = operatorPage({ view: "system" });
  assert.match(page, /<h2 id="storage-reserve-title">Storage reserve<\/h2>/);
  assert.match(page, /<dl id="storage-reserve-facts"><\/dl>/);
  assert.match(page, /<script src="\/assets\/storage-reserve\.js"><\/script>/);
  for (const view of ["repositories", "reviews", "system"]) {
    assert.match(
      operatorPage({ view }),
      /<script src="\/assets\/system-attention\.js"><\/script>/,
    );
  }

  const facts = element();
  const attention = element();
  const controls = new Map([
    ["storage-reserve-facts", facts],
    ["attention", attention],
  ]);
  /** @type {Array<(event: {detail: unknown}) => void>} */
  const loaded = [];
  const context = {
    document: {
      /** @param {string} name @param {(event: {detail: unknown}) => void} listener */
      addEventListener(name, listener) {
        if (name === "quality-bar:system-loaded") {
          loaded.push(listener);
        }
      },
      createElement() {
        return element();
      },
      /** @param {string} id */
      getElementById(id) {
        return controls.get(id) ?? null;
      },
    },
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-attention.js",
    readBrowserAsset("/assets/system-attention.js"),
    context,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/storage-reserve.js",
    readBrowserAsset("/assets/storage-reserve.js"),
    context,
  );

  assert.equal(loaded.length, 2);
  for (const listener of loaded) {
    listener({
      detail: {
        execution_providers: [
          { id: "codex", name: "Codex", status: "available" },
        ],
        storage: {
          filesystems: [
            {
              available_bytes: 6 * 1024 ** 3,
              filesystem: "state",
              path: "/var/lib/quality-bar",
              status: "available",
            },
            {
              available_bytes: 4 * 1024 ** 3,
              filesystem: "checkouts",
              path: "/var/cache/quality-bar/checkouts",
              status: "unavailable",
            },
          ],
          reserve_bytes: 5 * 1024 ** 3,
          status: "unavailable",
        },
      },
    });
  }

  assert.equal(facts.children.length, 6);
  assert.deepEqual(
    facts.children.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    [
      "Reserved free space",
      "5 GiB",
      "State filesystem",
      "/var/lib/quality-bar — 6 GiB available — available",
      "Checkout filesystem",
      "/var/cache/quality-bar/checkouts — 4 GiB available — unavailable",
    ],
  );
  assert.equal(attention.hidden, false);
  assert.equal(
    attention.textContent,
    "Storage reserve unavailable: 5 GiB reserved",
  );
});

test("provider attention stays generic and System shows the exact recovery", () => {
  const attention = element();
  const facts = element();
  const controls = new Map([
    ["attention", attention],
    ["execution-provider-facts", facts],
  ]);
  /** @type {Array<(event: {detail: unknown}) => void>} */
  const loaded = [];
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-attention.js",
    readBrowserAsset("/assets/system-attention.js"),
    {
      document: {
        /** @param {string} name @param {(event: {detail: unknown}) => void} listener */
        addEventListener(name, listener) {
          if (name === "quality-bar:system-loaded") {
            loaded.push(listener);
          }
        },
        createElement() {
          return element();
        },
        /** @param {string} id */
        getElementById(id) {
          return controls.get(id) ?? null;
        },
      },
    },
  );

  loaded[0]({
    detail: {
      execution_providers: [
        {
          error: {
            code: "codex_authentication_unavailable",
            message:
              "Codex is not signed in for this Quality Bar installation.",
            recovery:
              "Run `docker compose run --rm --no-deps quality-bar codex login --device-auth` from the Quality Bar installation directory, then restart Quality Bar.",
          },
          id: "codex",
          name: "Codex",
          status: "unavailable",
        },
      ],
      storage: { reserve_bytes: 5 * 1024 ** 3, status: "available" },
    },
  });

  assert.equal(attention.textContent, "Execution provider unavailable");
  assert.deepEqual(
    facts.children.map((/** @type {any} */ child) => ({
      children: child.children.map(
        (/** @type {{textContent: string}} */ { textContent }) => textContent,
      ),
      textContent: child.textContent,
    })),
    [
      { children: [], textContent: "Codex" },
      {
        children: [
          "Unavailable",
          " Codex is not signed in for this Quality Bar installation. ",
          "Fix: Run `docker compose run --rm --no-deps quality-bar codex login --device-auth` from the Quality Bar installation directory, then restart Quality Bar. ",
          "codex_authentication_unavailable",
        ],
        textContent: "",
      },
    ],
  );
});
