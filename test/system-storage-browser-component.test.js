import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

function element() {
  return /** @type {any} */ ({
    children: [],
    textContent: "",
    /** @param {any[]} children */
    replaceChildren(...children) {
      this.children = children;
    },
  });
}

test("System renders storage, cleanup, backup, and migration facts without operational controls", () => {
  const page = operatorPage({ view: "system" });
  assert.match(
    page,
    /<h2 id="system-storage-title">Storage, backup, and migration<\/h2>/,
  );
  assert.match(page, /id="system-storage-facts"/);
  assert.match(page, /<script src="\/assets\/system-storage\.js"><\/script>/);
  assert.doesNotMatch(
    page,
    /\b(restore|downgrade|dual-schema|remote backup)\b/i,
  );

  const factsContainer = element();
  /** @type {((event: {detail: unknown}) => void) | null} */
  let loaded = null;
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-storage.js",
    readBrowserAsset("/assets/system-storage.js"),
    {
      document: {
        /** @param {string} name @param {(event: {detail: unknown}) => void} listener */
        addEventListener(name, listener) {
          if (name === "quality-bar:system-loaded") {
            loaded = listener;
          }
        },
        createElement: () => element(),
        /** @param {string} id */
        getElementById(id) {
          return id === "system-storage-facts" ? factsContainer : null;
        },
      },
    },
  );
  if (!loaded) {
    throw new Error("system_storage_listener_missing");
  }
  const systemLoaded = /** @type {(event: {detail: unknown}) => void} */ (
    loaded
  );
  systemLoaded({
    detail: {
      application: {
        application_version: "1.2.3",
        error: null,
        installation_key_identity: `sha256:${"a".repeat(64)}`,
        schema_version: 53,
        status: "available",
      },
      backup: { error: null, last_successful: null, status: "empty" },
      migration: {
        error: null,
        from_schema_version: 53,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "not_applicable",
        status: "not_required",
        to_schema_version: 53,
      },
      storage: {
        cleanup: {
          artifacts_removed: 2,
          error: null,
          last_run_at: "2026-08-02T12:00:00.000Z",
          sessions_removed: 1,
          status: "available",
        },
      },
    },
  });
  assert.deepEqual(
    factsContainer.children.map(
      (/** @type {{textContent: string}} */ child) => child.textContent,
    ),
    [
      "Application",
      "1.2.3 — available",
      "Installation key identity",
      `sha256:${"a".repeat(64)}`,
      "Schema",
      "53",
      "Owned cleanup",
      "available — artifacts 2 — sessions 1",
      "Last successful backup",
      "empty — none",
      "Migration",
      "Not required · schema 53",
    ],
  );

  systemLoaded({
    detail: {
      application: {
        application_version: "1.2.3",
        error: null,
        installation_key_identity: `sha256:${"a".repeat(64)}`,
        schema_version: 53,
        status: "available",
      },
      backup: { error: null, last_successful: null, status: "empty" },
      migration: {
        error: null,
        from_schema_version: 53,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "not_applicable",
        status: "not_required",
        to_schema_version: 53,
      },
      storage: {
        cleanup: {
          artifacts_removed: null,
          error: {
            code: "owned_artifact_cleanup_remove_failed",
            detail: "Owned temporary artifact could not be removed",
          },
          last_run_at: "2026-08-02T12:00:00.000Z",
          sessions_removed: null,
          status: "unavailable",
        },
      },
    },
  });
  assert.equal(
    factsContainer.children[7].textContent,
    "unavailable — owned_artifact_cleanup_remove_failed: Owned temporary artifact could not be removed",
  );
});
