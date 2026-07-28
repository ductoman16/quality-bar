import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
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
  });
}

test("System renders exact state and checkout reserve facts and exposes low-space attention", () => {
  const page = operatorPage({ view: "system" });
  assert.match(page, /<h2 id="storage-reserve-title">Storage reserve<\/h2>/);
  assert.match(page, /<dl id="storage-reserve-facts"><\/dl>/);
  assert.match(page, /<script src="\/assets\/storage-reserve\.js"><\/script>/);

  const facts = element();
  const attention = element();
  const controls = new Map([
    ["storage-reserve-facts", facts],
    ["attention", attention],
  ]);
  /** @type {(event: {detail: unknown}) => void} */
  let loaded = () => {
    throw new Error("storage_reserve_listener_missing");
  };
  const context = {
    document: {
      /** @param {string} name @param {(event: {detail: unknown}) => void} listener */
      addEventListener(name, listener) {
        if (name === "quality-bar:system-loaded") {
          loaded = listener;
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
    "src/browser/storage-reserve.js",
    readBrowserAsset("/assets/storage-reserve.js"),
    context,
  );

  loaded({
    detail: {
      codex: {
        error: "codex_authentication_unavailable",
        status: "unavailable",
      },
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

  assert.equal(facts.children.length, 6);
  assert.deepEqual(
    facts.children.map(
      (/** @type {{textContent: string}} */ { textContent }) => textContent,
    ),
    [
      "Reserved free space",
      "5368709120 bytes",
      "State filesystem",
      "/var/lib/quality-bar — 6442450944 bytes available — available",
      "Checkout filesystem",
      "/var/cache/quality-bar/checkouts — 4294967296 bytes available — unavailable",
    ],
  );
  assert.equal(attention.hidden, false);
  assert.equal(
    attention.textContent,
    "Storage reserve unavailable: 5368709120 bytes reserved",
  );
});
