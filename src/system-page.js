// The System view is the operator's "is everything OK?" console. It opens with
// a health strip of status marks (populated best-effort by operator.js from the
// same /api/v1/system payload the bands consume), then lays out the detail
// bands as calm full-width LCD sections. Every id, heading, and the
// codex-execution → storage-reserve ordering the served system scripts and the
// secondary-shell test depend on are authored here verbatim; the
// Waiver Adjudicator Configuration authoring band stays a qb-deep-surface.

/** @param {string} id @param {string} label */
const healthTile = (id, label) =>
  `<div class="sys-health__tile" id="system-health-${id}"><span class="sys-health__label">${label}</span><span class="sys-health__value" id="system-health-${id}-value">—</span></div>`;

const HEALTH_SECTION =
  '<section class="qb-region sys-overview" aria-labelledby="system-health-title"><h2 class="qb-visually-hidden" id="system-health-title">Health</h2><div class="sys-health" id="system-health">' +
  healthTile("codex", "Codex provider") +
  healthTile("durable", "Durable core") +
  healthTile("storage", "Storage") +
  healthTile("backups", "Backups") +
  healthTile("migration", "Migration") +
  healthTile("bootstrap", "Bootstrap") +
  "</div></section>";

const EXECUTION_PROVIDERS_SECTION =
  '<section class="qb-region" aria-labelledby="execution-providers-title"><h2 id="execution-providers-title">Execution providers</h2><dl id="execution-provider-facts"></dl></section>';

const CODEX_EXECUTION_SECTION =
  '<section class="qb-region" aria-labelledby="codex-execution-title"><h2 id="codex-execution-title">Codex execution</h2><dl id="codex-execution-concurrency"></dl><div class="sys-lists"><div class="sys-list"><h3>Queued</h3><ol class="sys-log" data-empty="Nothing queued." id="codex-execution-queue"></ol></div><div class="sys-list"><h3>Running</h3><ol class="sys-log" data-empty="Nothing running." id="codex-execution-running"></ol></div><div class="sys-list"><h3>Failures</h3><ol class="sys-log" data-empty="No recent failures." id="codex-execution-failures"></ol></div></div></section>';

// operator.js fills this section with the "System status" heading and facts.
const SYSTEM_FACTS_SECTION =
  '<section class="qb-region" aria-live="polite" id="system-facts"></section>';

const STORAGE_RESERVE_SECTION =
  '<section class="qb-region" aria-labelledby="storage-reserve-title"><h2 id="storage-reserve-title">Storage reserve</h2><dl id="storage-reserve-facts"></dl></section>';

const STORAGE_SECTION =
  '<section class="qb-region" aria-labelledby="system-storage-title"><h2 id="system-storage-title">Storage, backup, and migration</h2><dl id="system-storage-facts"></dl></section>';

const POLLING_SECTION =
  '<section class="qb-region" aria-labelledby="system-polling-title"><h2 id="system-polling-title">Polling</h2><ol class="sys-log" data-empty="No polling connections." id="system-polling-connections"></ol></section>';

const DELIVERY_SECTION =
  '<section class="qb-region" aria-labelledby="system-delivery-title"><h2 id="system-delivery-title">Delivery</h2><ol class="sys-log" data-empty="No delivery surfaces." id="system-delivery-surfaces"></ol></section>';

// The waiver adjudicator configuration is a rare write action; it stays a
// de-emphasized deep surface low on the page. Its form ids/behavior are intact.
const WAIVER_CONFIG_SECTION =
  '<section class="qb-region qb-deep-surface" aria-labelledby="waiver-adjudicator-configuration-title"><h2 id="waiver-adjudicator-configuration-title">Waiver Adjudicator Configuration</h2><form hidden id="waiver-adjudicator-configuration-form"><label for="waiver-adjudicator-model">Model</label><select id="waiver-adjudicator-model" required></select><label for="waiver-adjudicator-reasoning-effort">Reasoning effort</label><select id="waiver-adjudicator-reasoning-effort" required></select><label for="waiver-adjudicator-service-tier">Service tier</label><select id="waiver-adjudicator-service-tier" required></select><button id="waiver-adjudicator-configuration-submit" type="submit">Save configuration</button><output aria-label="Waiver Adjudicator Configuration status" aria-live="polite" id="waiver-adjudicator-configuration-status"></output><p hidden id="waiver-adjudicator-configuration-error" role="alert" tabindex="-1"></p></form></section>';

const STYLE =
  "<style>" +
  "[hidden]{display:none!important}" +
  ".sys-overview{padding-top:18px}" +
  ".sys-health{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line)}" +
  ".sys-health__tile{display:grid;gap:9px;padding:18px 16px 18px 0;min-width:0}" +
  ".sys-health__label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".sys-health__value{display:inline-flex;align-items:center;gap:9px;font-size:15px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  '.sys-health__value::before{content:"";width:10px;height:10px;border:1px solid var(--qb-ink);border-radius:50%;flex:0 0 10px;background:transparent;border-style:dashed}' +
  '.sys-health__tile[data-state="ok"] .sys-health__value::before{background:var(--qb-ink);border-style:solid}' +
  '.sys-health__tile[data-state="idle"] .sys-health__value::before{background:transparent;border-style:solid}' +
  '.sys-health__tile[data-state="warn"] .sys-health__value::before{background:var(--qb-ink);border-style:solid;box-shadow:inset 0 0 0 2px var(--qb-canvas)}' +
  '.sys-health__tile[data-state="warn"] .sys-health__value{color:var(--qb-ink)}' +
  "#execution-provider-facts{grid-template-columns:max-content minmax(0,1fr);gap:8px 18px}" +
  "#execution-provider-facts dd{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}" +
  "#execution-provider-facts strong{font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--qb-muted-ink)}" +
  "#execution-provider-facts code{font-size:11px;color:var(--qb-muted-ink)}" +
  "#codex-execution-concurrency{grid-template-columns:repeat(3,max-content minmax(0,1fr));gap:6px 14px;max-width:60ch}" +
  ".sys-lists{display:grid;gap:18px;margin-top:20px}" +
  ".sys-list>h3{margin:0 0 8px;color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".sys-log{list-style:none;margin:0;padding:0;display:grid;gap:8px}" +
  ".sys-log>li{font-size:12px;line-height:1.5;padding-left:16px;position:relative;overflow-wrap:anywhere}" +
  '.sys-log>li::before{content:"";position:absolute;left:0;top:7px;width:5px;height:5px;border:1px solid var(--qb-ink);border-radius:50%}' +
  ".sys-log>li a{font-family:var(--font-mono);text-underline-offset:2px}" +
  ".sys-log:empty::after{content:attr(data-empty);display:block;color:var(--qb-muted-ink);font-size:12px;font-style:normal}" +
  "#system-facts .system-model-list{list-style:none;padding:0;display:grid;gap:4px;font-family:var(--font-mono);font-size:12px}" +
  "#system-storage-facts,#storage-reserve-facts{grid-template-columns:max-content minmax(0,1fr);gap:8px 18px}" +
  "#system-storage-facts dd,#storage-reserve-facts dd{font-size:13px;overflow-wrap:anywhere}" +
  "@media(max-width:900px){.sys-health{grid-template-columns:repeat(3,minmax(0,1fr))}.sys-health__tile{padding-right:12px}}" +
  "@media(max-width:600px){.sys-health{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
  "</style>";

const SCRIPTS =
  '<script src="/assets/system-polling-delivery-contract.js"></script>' +
  '<script src="/assets/system-polling-delivery.js"></script>' +
  '<script src="/assets/system-storage.js"></script>' +
  '<script src="/assets/system-execution.js"></script>' +
  '<script src="/assets/storage-reserve.js"></script>' +
  '<script src="/assets/waiver-adjudicator-configuration.js"></script>';

/** Render the operator System view. */
export function renderSystemPage() {
  return Object.freeze({
    markup:
      HEALTH_SECTION +
      EXECUTION_PROVIDERS_SECTION +
      CODEX_EXECUTION_SECTION +
      SYSTEM_FACTS_SECTION +
      STORAGE_RESERVE_SECTION +
      STORAGE_SECTION +
      POLLING_SECTION +
      DELIVERY_SECTION +
      WAIVER_CONFIG_SECTION +
      STYLE,
    scripts: SCRIPTS,
  });
}
