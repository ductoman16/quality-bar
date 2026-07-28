import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { element } from "./github-connection-browser-component-support.js";

test("Forgejo Connection discovers semantic Repository choices then atomically registers checked choices", async () => {
  const page = operatorPage({ view: "repositories" });
  assert.match(
    page,
    /<fieldset disabled id="forgejo-connection-repository-fieldset"><legend>Forgejo Repositories<\/legend><div id="forgejo-connection-repositories"><\/div><\/fieldset>.*aria-live="polite" id="forgejo-connection-status" tabindex="-1".*role="alert" tabindex="-1"/,
  );
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  const form = element();
  const baseUrl = /** @type {any} */ (
    element({ value: "https://forgejo.example" })
  );
  const token = /** @type {any} */ (element({ value: "operator-created-pat" }));
  const repositories = element({
    querySelector() {
      return this.children[0]?.children[0] ?? null;
    },
    querySelectorAll() {
      return this.children
        .map(/** @param {any} label */ (label) => label.children[0])
        .filter(/** @param {any} control */ (control) => control.checked);
    },
  });
  const fieldset = element({ disabled: true });
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const controls = new Map([
    ["forgejo-connection-form", form],
    ["forgejo-connection-base-url", baseUrl],
    ["forgejo-connection-token", token],
    ["forgejo-connection-repositories", repositories],
    ["forgejo-connection-repository-fieldset", fieldset],
    ["forgejo-connection-submit", submit],
    ["forgejo-connection-status", status],
    ["forgejo-connection-error", error],
  ]);
  /** @type {any[]} */
  const requests = [];
  let ready = () => {};
  const context = {
    document: { createElement: () => element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      requests.push({ options, path });
      return {
        ok: true,
        async json() {
          return path.endsWith("/discover")
            ? [{ full_name: "operator/private", id: 11 }]
            : { id: "forgejo-connection" };
        },
      };
    },
    window: {
      addEventListener(
        /** @type {string} */ name,
        /** @type {() => void} */ listener,
      ) {
        assert.equal(name, "DOMContentLoaded");
        ready = listener;
      },
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        requiredElement: (/** @type {string} */ id) => controls.get(id),
      },
    },
  };
  executeServedBrowserAsset(
    resolve(import.meta.dirname, ".."),
    "src/browser/forgejo-connection.js",
    readBrowserAsset("/assets/forgejo-connection.js"),
    context,
  );
  ready();
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(fieldset.disabled, false);
  assert.equal(repositories.children[0].children[0].focused, true);
  assert.equal(status.textContent, "Forgejo Repositories verified.");
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Select at least one Forgejo Repository");
  assert.equal(repositories.children[0].children[0].focused, true);
  repositories.children[0].children[0].checked = true;
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  assert.equal(requests[1].path, "/api/v1/forgejo-connections");
  assert.equal(status.focused, true);
  assert.equal(token.value, "");
});
