import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

function element() {
  return /** @type {any} */ ({
    children: [],
    textContent: "",
    /** @param {any[]} children */
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children
        .map((child) => child.textContent ?? "")
        .join("");
    },
  });
}

/** @param {any} container */
function links(container) {
  return container.children.flatMap((/** @type {any} */ child) =>
    child.children.filter((/** @type {any} */ nested) => nested.href),
  );
}

const error = {
  code: "provider_rate_limited",
  detail: "Exact provider error.",
};

test("System renders polling ownership and distinct delivery states", () => {
  const page = operatorPage({ view: "system" });
  assert.match(page, /<h2 id="system-polling-title">Polling<\/h2>/);
  assert.match(page, /id="system-polling-connections"/);
  assert.match(page, /<h2 id="system-delivery-title">Delivery<\/h2>/);
  assert.match(page, /id="system-delivery-surfaces"/);
  assert.match(
    page,
    /<script src="\/assets\/system-polling-delivery\.js"><\/script>/,
  );
  assert.match(
    page,
    /<script src="\/assets\/system-polling-delivery-contract\.js"><\/script>/,
  );
  assert.doesNotMatch(page, /\bJob\b/);

  const controls = new Map(
    ["system-polling-connections", "system-delivery-surfaces"].map((id) => [
      id,
      element(),
    ]),
  );
  /** @type {((event: {detail: unknown}) => void) | null} */
  let loaded = null;
  const browserContext = /** @type {any} */ ({
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
        return controls.get(id) ?? null;
      },
    },
  });
  browserContext.window = browserContext;
  browserContext.URL = URL;
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-polling-delivery-contract.js",
    readBrowserAsset("/assets/system-polling-delivery-contract.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/system-polling-delivery.js",
    readBrowserAsset("/assets/system-polling-delivery.js"),
    browserContext,
  );
  if (!loaded) {
    throw new Error("system_polling_delivery_listener_missing");
  }
  const systemLoaded = /** @type {(event: {detail: unknown}) => void} */ (
    loaded
  );
  const systemDetail = {
    polling: {
      connections: [
        {
          connection_id: "connection-github",
          error,
          external_identity: {
            app_id: 47,
            app_slug: "quality-bar",
            installation_id: 73,
            principal_id: 91,
            principal_login: "operator",
          },
          health: "healthy",
          health_error: null,
          lifecycle: "enabled",
          next_attempt_at: null,
          next_attempt_after_correction: true,
          provider: "github",
          rate_gate_until: "2026-08-02T12:02:00.000Z",
          repositories: [
            {
              baseline_status: "pending",
              error: null,
              forge_repository_id: 101,
              health: "healthy",
              health_error: null,
              last_success_at: null,
              name: "operator/repository",
              lifecycle: "enabled",
              next_attempt_at: null,
              next_attempt_after_correction: true,
              rate_gate_until: null,
              repository_id: "repository-1",
            },
          ],
        },
        {
          connection_id: "connection-forgejo",
          error: null,
          external_identity: {
            base_url: "https://forgejo.example",
            principal_id: 92,
            principal_login: "operator",
            reported_version: "16.0.4",
          },
          health: "healthy",
          health_error: null,
          lifecycle: "retired",
          next_attempt_at: null,
          next_attempt_after_correction: false,
          provider: "forgejo",
          rate_gate_until: null,
          repositories: [],
        },
      ],
    },
    delivery: {
      surfaces: [
        "waiting",
        "retry_scheduled",
        "reconciling",
        "succeeded",
        "unavailable",
        "aggregate_only",
      ].map((status, index) => ({
        adjudication_id: index < 2 ? "adjudication-1" : null,
        attempt_count: status === "aggregate_only" ? 0 : index,
        connection_id: "connection-github",
        decision_id: index === 1 ? "decision-1" : null,
        definitive: status === "unavailable",
        error: status === "unavailable" ? error : null,
        evaluation_id: "evaluation-1",
        external_id: status === "succeeded" ? 200 + index : null,
        finding_id: index === 1 ? "finding-inline" : null,
        last_attempt_at: index === 0 ? null : "2026-08-02T12:00:00.000Z",
        next_attempt_at:
          status === "retry_scheduled" ? "2026-08-02T12:03:00.000Z" : null,
        owner_kind:
          index === 0
            ? "adjudication"
            : index === 1
              ? "decision"
              : "evaluation",
        published_at:
          status === "succeeded" ? "2026-08-02T12:04:00.000Z" : null,
        provider: "github",
        provider_gate_error: status === "retry_scheduled" ? error : null,
        provider_gate_until:
          status === "retry_scheduled" ? "2026-08-02T12:03:00.000Z" : null,
        publication_status:
          status === "aggregate_only"
            ? "aggregate_only"
            : status === "succeeded"
              ? "succeeded"
              : status === "unavailable"
                ? "unavailable"
                : "waiting",
        reconciliation_required: status === "reconciling",
        repository_id: "repository-1",
        source_identity: `surface-${index}`,
        status,
        surface: "commit_status",
        target: status === "aggregate_only" ? "aggregate_only" : "{}",
      })),
    },
  };
  systemLoaded({ detail: systemDetail });
  const pollingText = controls
    .get("system-polling-connections")
    ?.children.map(
      (/** @type {{textContent: string}} */ child) => child.textContent,
    )
    .join(" ");
  assert.match(pollingText, /Baseline pending/);
  assert.match(pollingText, /Exact provider error\./);
  assert.match(pollingText, /external 47/);
  assert.match(pollingText, /installation 73/);
  assert.match(pollingText, /external 101/);
  assert.match(pollingText, /Next permitted attempt after correction/);
  assert.match(
    pollingText,
    /Repository repository-1.*Next permitted attempt after correction/,
  );
  assert.match(pollingText, /forgejo Connection connection-forgejo/);
  assert.match(
    pollingText,
    /Base URL https:\/\/forgejo\.example, version 16\.0\.4/,
  );
  const pollingLinks = links(controls.get("system-polling-connections"));
  assert.ok(
    pollingLinks.some(
      (/** @type {any} */ link) =>
        link.textContent === "Connection connection-github" &&
        link.href ===
          "/?view=repositories&connection_id=connection-github#github-connection-details",
    ),
  );
  assert.ok(
    pollingLinks.some(
      (/** @type {any} */ link) =>
        link.textContent === "Repository repository-1" &&
        link.href === "/?view=repositories#repository-repository-1",
    ),
  );
  const deliveryText = controls
    .get("system-delivery-surfaces")
    ?.children.map(
      (/** @type {{textContent: string}} */ child) => child.textContent,
    )
    .join(" ");
  for (const status of [
    "waiting",
    "retry_scheduled",
    "reconciling",
    "succeeded",
    "unavailable",
    "aggregate_only",
  ]) {
    assert.match(deliveryText, new RegExp(`Status ${status}`));
  }
  assert.match(deliveryText, /Reconciliation required/);
  assert.match(deliveryText, /External identity 203/);
  assert.match(deliveryText, /Adjudication adjudication-1/);
  assert.match(
    deliveryText,
    /Decision decision-1; Adjudication adjudication-1/,
  );
  assert.match(deliveryText, /Status succeeded;.*Next permitted attempt none/);
  assert.match(
    deliveryText,
    /Status unavailable;.*Next permitted attempt none/,
  );
  assert.match(
    deliveryText,
    /Status aggregate_only;.*Next permitted attempt none/,
  );
  assert.match(
    deliveryText,
    /Provider gate .*provider_rate_limited: Exact provider error\./,
  );
  const deliveryLinks = links(controls.get("system-delivery-surfaces"));
  assert.ok(
    deliveryLinks.some(
      (/** @type {any} */ link) =>
        link.textContent === "Evaluation evaluation-1" &&
        link.href === "/?view=evaluations&evaluation_id=evaluation-1",
    ),
  );
  assert.ok(
    deliveryLinks.some(
      (/** @type {any} */ link) =>
        link.textContent === "Decision decision-1" &&
        link.href === "/api/v1/waiver-decisions/decision-1",
    ),
  );
  const evaluationInline = JSON.parse(JSON.stringify(systemDetail));
  evaluationInline.delivery.surfaces[2].surface = "inline_feedback";
  evaluationInline.delivery.surfaces[2].finding_id = "finding-inline";
  assert.doesNotThrow(() => systemLoaded({ detail: evaluationInline }));
  const evaluationAggregateOnly = JSON.parse(JSON.stringify(systemDetail));
  evaluationAggregateOnly.delivery.surfaces[5].surface = "inline_feedback";
  evaluationAggregateOnly.delivery.surfaces[5].finding_id = "finding-whole";
  assert.doesNotThrow(() => systemLoaded({ detail: evaluationAggregateOnly }));
  const invalidCompleteNextAttempt = JSON.parse(JSON.stringify(systemDetail));
  Object.assign(
    invalidCompleteNextAttempt.polling.connections[0].repositories[0],
    {
      baseline_status: "complete",
      error: null,
      last_success_at: "2026-08-02T12:01:00.000Z",
      next_attempt_at: null,
      next_attempt_after_correction: false,
      rate_gate_until: null,
    },
  );
  assert.throws(
    () => systemLoaded({ detail: invalidCompleteNextAttempt }),
    /system_polling_repository_next_attempt_invalid/,
  );
  const invalidTimestamp = JSON.parse(JSON.stringify(systemDetail));
  invalidTimestamp.polling.connections[0].next_attempt_at = "not-a-timestamp";
  assert.throws(
    () => systemLoaded({ detail: invalidTimestamp }),
    /system_polling_connection_next_attempt_invalid/,
  );
  const invalidError = JSON.parse(JSON.stringify(systemDetail));
  invalidError.polling.connections[0].health_error = { ...error };
  invalidError.polling.connections[0].health_error.detail = " ";
  assert.throws(
    () => systemLoaded({ detail: invalidError }),
    /system_polling_connection_health_error_invalid/,
  );
  const invalidState = JSON.parse(JSON.stringify(systemDetail));
  invalidState.delivery.surfaces[0].status = "succeeded";
  assert.throws(
    () => systemLoaded({ detail: invalidState }),
    /system_delivery_surface_state_invalid/,
  );
  const invalidRepository = JSON.parse(JSON.stringify(systemDetail));
  invalidRepository.polling.connections[0].repositories[0].forge_repository_id = 0;
  assert.throws(
    () => systemLoaded({ detail: invalidRepository }),
    /system_polling_repository_invalid/,
  );
  const invalidIneligibleAttempt = JSON.parse(JSON.stringify(systemDetail));
  invalidIneligibleAttempt.polling.connections[1].next_attempt_at =
    "2026-08-02T12:03:00.000Z";
  assert.throws(
    () => systemLoaded({ detail: invalidIneligibleAttempt }),
    /system_polling_connection_next_attempt_state_invalid/,
  );
  const invalidUri = JSON.parse(JSON.stringify(systemDetail));
  invalidUri.polling.connections[1].external_identity.base_url = "forgejo";
  assert.throws(
    () => systemLoaded({ detail: invalidUri }),
    /system_polling_connection_invalid/,
  );
  const invalidGate = JSON.parse(JSON.stringify(systemDetail));
  invalidGate.delivery.surfaces[1].provider_gate_until = null;
  assert.throws(
    () => systemLoaded({ detail: invalidGate }),
    /system_delivery_provider_gate_invalid/,
  );
  const invalidSurface = JSON.parse(JSON.stringify(systemDetail));
  invalidSurface.delivery.surfaces[0] = null;
  assert.throws(
    () => systemLoaded({ detail: invalidSurface }),
    /system_delivery_surface_invalid/,
  );
  const invalidSucceededAttempt = JSON.parse(JSON.stringify(systemDetail));
  invalidSucceededAttempt.delivery.surfaces[3].attempt_count = 0;
  assert.throws(
    () => systemLoaded({ detail: invalidSucceededAttempt }),
    /system_delivery_surface_state_invalid/,
  );
  assert.equal(
    controls.get("system-polling-connections")?.children[0]?.textContent,
    "Unavailable: system_delivery_surface_state_invalid",
  );
});
