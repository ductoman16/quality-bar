"use strict";

/** @typedef {{text: string, href: string | null}} BrowserPart */

const connections = document.getElementById("system-polling-connections");
const surfaces = document.getElementById("system-delivery-surfaces");
const browserGlobals = /** @type {any} */ (window);
const requireFacts = browserGlobals.systemPollingDeliveryRequireFacts;

/** @type {(value: string | null, empty: string) => string} */
const present = (value, empty) => value ?? empty;

/** @type {(value: any) => string} */
const errorLabel = (value) =>
  value ? `${value.code}: ${value.detail}` : "none";

/** @param {string | null} value @param {any} problem */
function nextPermittedAttempt(
  value,
  problem,
  lifecycle = "enabled",
  afterCorrection = false,
) {
  if (value !== null) {
    return value;
  }
  return afterCorrection || problem !== null
    ? "after correction"
    : lifecycle === "enabled"
      ? "now"
      : "after lifecycle change";
}

/** @param {string} provider @param {string} connectionId */
function connectionHref(provider, connectionId) {
  return `/?view=repositories&connection_id=${encodeURIComponent(connectionId)}#${provider}-connection-details`;
}

/** @param {string} repositoryId */
function repositoryHref(repositoryId) {
  return `/?view=repositories#repository-${encodeURIComponent(repositoryId)}`;
}

/** @param {string} evaluationId @param {string | null} [adjudicationId] */
function evaluationHref(evaluationId, adjudicationId = null) {
  const anchor =
    adjudicationId === null
      ? ""
      : `#waiver-adjudication-${encodeURIComponent(adjudicationId)}`;
  return `/?view=evaluations&evaluation_id=${encodeURIComponent(evaluationId)}${anchor}`;
}

/** @param {string} decisionId */
function decisionHref(decisionId) {
  return `/api/v1/waiver-decisions/${encodeURIComponent(decisionId)}`;
}

/** @type {(text: string) => BrowserPart} */
const textPart = (text) => ({ href: null, text });

/** @type {(text: string, href: string) => BrowserPart} */
const linkPart = (text, href) => ({ href, text });

/** @param {any} connection @returns {BrowserPart[]} */
function pollingLabel(connection) {
  const identity = connection.external_identity;
  const providerIdentity =
    connection.provider === "github"
      ? `App ${identity.app_slug} (external ${identity.app_id}), installation ${identity.installation_id}`
      : `Base URL ${identity.base_url}, version ${identity.reported_version}`;
  /** @type {BrowserPart[]} */
  const parts = [
    textPart(`${connection.provider} `),
    linkPart(
      `Connection ${connection.connection_id}`,
      connectionHref(connection.provider, connection.connection_id),
    ),
    textPart(
      `. Lifecycle ${connection.lifecycle}. Health ${connection.health}. Health error ${errorLabel(connection.health_error)}. Principal ${identity.principal_login} (external ${identity.principal_id}). ${providerIdentity}. Next permitted attempt ${nextPermittedAttempt(connection.next_attempt_at, connection.error, connection.lifecycle, connection.next_attempt_after_correction)}. Rate gate ${present(connection.rate_gate_until, "none")}. Error ${errorLabel(connection.error)}.`,
    ),
  ];
  for (const repository of connection.repositories) {
    parts.push(
      textPart(" "),
      linkPart(
        `Repository ${repository.repository_id}`,
        repositoryHref(repository.repository_id),
      ),
      textPart(
        ` (${repository.name}, external ${repository.forge_repository_id}). Lifecycle ${repository.lifecycle}. Health ${repository.health}. Health error ${errorLabel(repository.health_error)}. Baseline ${repository.baseline_status}. Last success ${present(repository.last_success_at, "none")}. Next permitted attempt ${nextPermittedAttempt(repository.next_attempt_at, repository.error ?? repository.health_error ?? connection.error ?? connection.health_error, repository.lifecycle, repository.next_attempt_after_correction)}. Rate gate ${present(repository.rate_gate_until, "none")}. Error ${errorLabel(repository.error)}.`,
      ),
    );
  }
  return parts;
}

/** @param {any} surface @returns {BrowserPart[]} */
function ownerParts(surface) {
  const evaluation = linkPart(
    `Evaluation ${surface.evaluation_id}`,
    evaluationHref(surface.evaluation_id),
  );
  if (surface.owner_kind === "adjudication") {
    return [
      linkPart(
        `Adjudication ${surface.adjudication_id}`,
        evaluationHref(surface.evaluation_id, surface.adjudication_id),
      ),
      textPart("; "),
      evaluation,
    ];
  }
  if (surface.owner_kind === "decision") {
    return [
      linkPart(
        `Decision ${surface.decision_id}`,
        decisionHref(surface.decision_id),
      ),
      textPart("; "),
      linkPart(
        `Adjudication ${surface.adjudication_id}`,
        evaluationHref(surface.evaluation_id, surface.adjudication_id),
      ),
      textPart("; "),
      evaluation,
    ];
  }
  return [evaluation];
}

/** @param {any} surface */
function nextAttemptLabel(surface) {
  return (
    surface.next_attempt_at ??
    (["waiting", "reconciling"].includes(surface.status) ? "now" : "none")
  );
}

/** @param {any} surface @returns {BrowserPart[]} */
function deliveryLabel(surface) {
  return [
    ...ownerParts(surface),
    textPart(". Repository "),
    linkPart(surface.repository_id, repositoryHref(surface.repository_id)),
    textPart(". Connection "),
    linkPart(
      surface.connection_id,
      connectionHref(surface.provider, surface.connection_id),
    ),
    textPart(
      `. Surface ${surface.surface}. Status ${surface.status}; publication ${surface.publication_status}. Attempts ${surface.attempt_count}. Last attempt ${present(surface.last_attempt_at, "none")}. Published ${present(surface.published_at, "none")}. Next permitted attempt ${nextAttemptLabel(surface)}. Reconciliation ${surface.reconciliation_required ? "required" : "not required"}. External identity ${present(surface.external_id, "none")}. Provider gate ${present(surface.provider_gate_until, "none")} (${errorLabel(surface.provider_gate_error)}). Error ${errorLabel(surface.error)}. Source ${surface.source_identity}.`,
    ),
  ];
}

/** @param {HTMLElement} container @param {BrowserPart[][]} rows */
function replaceRows(container, rows) {
  container.replaceChildren(
    ...rows.map((parts) => {
      const item = document.createElement("li");
      item.replaceChildren(
        ...parts.map((part) => {
          const child =
            part.href === null
              ? document.createElement("span")
              : document.createElement("a");
          if (part.href !== null) {
            const anchor = /** @type {HTMLAnchorElement} */ (child);
            anchor.href = part.href;
          }
          child.textContent = part.text;
          return child;
        }),
      );
      return item;
    }),
  );
}

/** @param {HTMLElement} container @param {string} message */
function replaceUnavailable(container, message) {
  const item = document.createElement("li");
  item.textContent = `Unavailable: ${message}`;
  container.replaceChildren(item);
}

document.addEventListener("quality-bar:system-loaded", (event) => {
  if (!connections || !surfaces) {
    throw new Error("system_polling_delivery_controls_missing");
  }
  try {
    const facts = requireFacts(/** @type {any} */ (event).detail);
    replaceRows(connections, facts.polling.connections.map(pollingLabel));
    replaceRows(surfaces, facts.delivery.surfaces.map(deliveryLabel));
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "system_polling_delivery_facts_invalid";
    replaceUnavailable(connections, message);
    replaceUnavailable(surfaces, message);
    throw cause;
  }
});
