const OVERVIEW_SECTION =
  '<section class="qb-region repo-overview" aria-labelledby="repository-overview-title"><h2 class="qb-visually-hidden" id="repository-overview-title">Overview</h2><div class="repo-stat-strip"><div class="repo-stat"><span class="repo-stat__label">Repositories</span><output class="repo-stat__value" id="repository-overview-total">—</output></div><div class="repo-stat" data-mark="filled"><span class="repo-stat__label">Enabled</span><output class="repo-stat__value" id="repository-overview-enabled">—</output></div><div class="repo-stat" data-mark="hollow"><span class="repo-stat__label">Disabled</span><output class="repo-stat__value" id="repository-overview-disabled">—</output></div><div class="repo-stat" data-mark="dashed"><span class="repo-stat__label">Retired</span><output class="repo-stat__value" id="repository-overview-retired">—</output></div><div class="repo-stat" data-mark="filled"><span class="repo-stat__label">Health errors</span><output class="repo-stat__value" id="repository-overview-errors">—</output></div></div></section>';

// The inventory is an interactive ledger: repository.js renders one expandable
// `.repo-row` per repository into #repository-inventory, each carrying inline
// lifecycle / credential / delete actions and a link to its detail page.
const INVENTORY_SECTION =
  '<section class="qb-region repo-inventory" aria-labelledby="repository-inventory-title"><h2 id="repository-inventory-title">Repository inventory</h2><div class="repo-ledger" id="repository-inventory"></div><p class="repo-ledger__empty" hidden id="repository-inventory-empty">No repositories registered yet.</p></section>';

// Lifecycle and credential rotation remain as forms so their exact request,
// confirmation, and reconciliation behavior is reused; the ledger row actions
// and the detail page both drive them. They are visually clipped because those
// row/detail actions are the operator surface, but stay operable.
const LIFECYCLE_FORM =
  '<form id="repository-lifecycle-form"><label for="repository-lifecycle-repository">Repository lifecycle</label><select disabled id="repository-lifecycle-repository" required></select><label for="repository-lifecycle-state">State</label><select id="repository-lifecycle-state" required><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="retired">Retired</option></select><button disabled id="repository-lifecycle-submit" type="submit">Apply lifecycle</button><button disabled id="repository-delete" type="button">Delete Repository</button><output aria-live="polite" id="repository-lifecycle-result" tabindex="-1"></output></form>';

const CREDENTIAL_FORM =
  '<form id="repository-credential-rotate-form"><label for="repository-credential-rotate-repository">Credential Repository</label><select disabled id="repository-credential-rotate-repository" required></select><label for="repository-credential-rotate-username">Replacement username</label><input autocomplete="off" id="repository-credential-rotate-username" required type="text"><label for="repository-credential-rotate-token">Replacement token</label><input autocomplete="off" id="repository-credential-rotate-token" required type="password"><button disabled id="repository-credential-rotate-submit" type="submit">Rotate credential</button><output aria-live="polite" id="repository-credential-rotate-result"></output></form>';

const CREATE_FORM =
  '<form id="repository-create-form"><label for="repository-url">HTTPS URL</label><input id="repository-url" name="url" required type="url"><label for="repository-username">Username</label><input autocomplete="off" id="repository-username" name="username" type="text"><label for="repository-token">Token</label><input autocomplete="off" id="repository-token" name="token" type="password"><button type="submit">Register Repository</button><output aria-live="polite" id="repository-create-result"></output></form>';

const ENGINE_SECTION =
  '<div class="repo-engine">' + LIFECYCLE_FORM + CREDENTIAL_FORM + "</div>";

const DELETE_DIALOG =
  '<dialog aria-labelledby="repository-delete-confirmation-title" id="repository-delete-confirmation"><form id="repository-delete-confirmation-form"><h2 id="repository-delete-confirmation-title">Delete Repository permanently</h2><p id="repository-delete-confirmation-message"></p><label for="repository-delete-confirmation-input">Repository identity</label><input autocomplete="off" id="repository-delete-confirmation-input" required type="text"><button id="repository-delete-confirmation-cancel" type="button">Cancel</button><button id="repository-delete-confirmation-submit" type="submit">Delete permanently</button></form></dialog>';

const REGISTER_SECTION =
  '<section class="qb-region repo-register" aria-labelledby="repository-register-title"><h2 id="repository-register-title">Register HTTPS repository</h2>' +
  CREATE_FORM +
  "</section>";

// The GitHub section markup order is asserted verbatim by
// github-connection-browser-component.test.js; the outer section class must
// stay exactly "qb-region".
const GITHUB_SECTION =
  '<section class="qb-region" aria-labelledby="github-connection-title"><h2 id="github-connection-title">GitHub Connection</h2><form id="github-connection-form"><label hidden id="github-connection-pem-label" for="github-connection-pem">Replacement private key</label><textarea hidden id="github-connection-pem"></textarea><button id="github-connection-submit" title="Connect GitHub App" type="submit">Connect GitHub App</button></form><section class="qb-region qb-deep-surface" aria-labelledby="github-connection-state-title" hidden id="github-connection-details"><h3 id="github-connection-state-title">Connection state</h3><dl><dt>Identity</dt><dd id="github-connection-identity"></dd><dt>API profile</dt><dd id="github-connection-profile"></dd><dt>Lifecycle</dt><dd id="github-connection-lifecycle"></dd><dt>Health</dt><dd id="github-connection-health"></dd><dt>Permissions</dt><dd id="github-connection-permissions"></dd><dt>Capabilities</dt><dd id="github-connection-capabilities"></dd><dt>Latest verification</dt><dd id="github-connection-latest"></dd></dl><h4>Verification history</h4><ol id="github-connection-history"></ol><h4>Polling</h4><ul aria-live="polite" id="github-connection-polling"></ul><form id="github-connection-lifecycle-form"><button id="github-connection-retire" title="Retire GitHub Connection" type="button">Retire GitHub Connection</button><button id="github-connection-delete" title="Delete GitHub Connection" type="button">Delete GitHub Connection</button></form><dialog aria-labelledby="github-connection-confirmation-title" id="github-connection-confirmation"><form id="github-connection-confirmation-form"><h4 id="github-connection-confirmation-title">Confirm GitHub Connection change</h4><p id="github-connection-confirmation-message"></p><label hidden id="github-connection-confirmation-label" for="github-connection-confirmation-input">Type DELETE to confirm permanent deletion</label><input hidden id="github-connection-confirmation-input" type="text"><button id="github-connection-confirmation-cancel" title="Cancel" type="button">Cancel</button><button id="github-connection-confirmation-submit" type="submit">Confirm</button></form></dialog><form hidden id="github-repository-selection-form"><fieldset id="github-repository-selection-fieldset"><legend>GitHub Repositories</legend><div id="github-repository-selection-options"></div></fieldset><button id="github-repository-selection-submit" type="submit">Register selected Repositories</button></form></section><form hidden id="github-connection-rotation-form"><label for="github-connection-rotation-pem">Replacement private key</label><textarea autocomplete="off" id="github-connection-rotation-pem" required></textarea><button id="github-connection-rotation-submit" type="submit">Rotate GitHub App credentials</button></form><output class="qb-status" aria-live="polite" id="github-connection-status" tabindex="-1"></output><p hidden id="github-connection-error" role="alert" tabindex="-1"></p></section>';

// The Forgejo section previously lost its connection-state, reactivation,
// lifecycle, and confirmation markup to a no-op string replacement, so
// forgejo-connection.js threw browser_control_unavailable on load. The full
// markup its controls require is authored here directly.
const FORGEJO_SECTION =
  '<section class="qb-region" aria-labelledby="forgejo-connection-title"><h2 id="forgejo-connection-title">Forgejo Connection</h2><form hidden id="forgejo-connection-form"><label for="forgejo-connection-base-url">Forgejo URL</label><input id="forgejo-connection-base-url" required type="url"><label for="forgejo-connection-token">Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-token" required type="password"><fieldset disabled id="forgejo-connection-repository-fieldset"><legend>Forgejo Repositories</legend><div id="forgejo-connection-repositories"></div></fieldset><button id="forgejo-connection-submit" title="Verify and register Forgejo Repositories" type="submit">Verify and register Forgejo Repositories</button></form><section class="qb-region qb-deep-surface" aria-labelledby="forgejo-connection-state-title" hidden id="forgejo-connection-details"><h3 id="forgejo-connection-state-title">Connection state</h3><dl><dt>Repository owner</dt><dd id="forgejo-connection-identity"></dd><dt>Lifecycle</dt><dd id="forgejo-connection-lifecycle"></dd><dt>Health</dt><dd id="forgejo-connection-health"></dd><dt>Profile</dt><dd id="forgejo-connection-profile"></dd><dt>Required authorities</dt><dd id="forgejo-connection-scopes"></dd><dt>Capabilities</dt><dd id="forgejo-connection-capabilities"></dd><dt>Latest verification</dt><dd id="forgejo-connection-latest"></dd></dl><h4>Verification history</h4><ol id="forgejo-connection-history"></ol><h4>Polling</h4><ul aria-live="polite" id="forgejo-connection-polling"></ul></section><form hidden id="forgejo-connection-rotation-form"><label for="forgejo-connection-rotation-token">Replacement Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-rotation-token" required type="password"><button id="forgejo-connection-rotation-submit" title="Rotate Forgejo PAT" type="submit">Rotate Forgejo PAT</button></form><form hidden id="forgejo-connection-reactivation-form"><label for="forgejo-connection-reactivation-token">Reactivation PAT</label><input autocomplete="off" id="forgejo-connection-reactivation-token" required type="password"><button id="forgejo-connection-reactivation-submit" title="Reactivate Forgejo Connection" type="submit">Reactivate Forgejo Connection</button></form><form hidden id="forgejo-connection-lifecycle-form"><button id="forgejo-connection-retire" title="Retire Forgejo Connection" type="button">Retire Forgejo Connection</button><button id="forgejo-connection-delete" title="Delete Forgejo Connection" type="button">Delete Forgejo Connection</button></form><dialog aria-labelledby="forgejo-connection-confirmation-title" id="forgejo-connection-confirmation"><form id="forgejo-connection-confirmation-form"><h4 id="forgejo-connection-confirmation-title">Confirm Forgejo Connection change</h4><p id="forgejo-connection-confirmation-message"></p><label hidden id="forgejo-connection-confirmation-label" for="forgejo-connection-confirmation-input">Type DELETE to confirm permanent deletion</label><input hidden id="forgejo-connection-confirmation-input" type="text"><button id="forgejo-connection-confirmation-cancel" title="Cancel" type="button">Cancel</button><button id="forgejo-connection-confirmation-submit" type="submit">Confirm</button></form></dialog><output class="qb-status" aria-live="polite" id="forgejo-connection-status" tabindex="-1"></output><p hidden id="forgejo-connection-error" role="alert" tabindex="-1"></p></section>';

// The detail view reuses the (clipped) lifecycle/credential/create engine so
// repository.js and repository-delete.js load and expose their tested mutation
// behavior; repository-detail.js reads the repository_id, renders the readable
// panel, and drives that engine.
const DETAIL_ENGINE =
  '<div class="repo-engine"><div id="repository-inventory"></div>' +
  CREATE_FORM +
  LIFECYCLE_FORM +
  CREDENTIAL_FORM +
  "</div>";

const DETAIL_SCAFFOLD =
  '<section class="qb-region repo-detail" aria-labelledby="repository-detail-name">' +
  '<a class="repo-detail__back" href="/?view=repositories">Repositories</a>' +
  '<div class="repo-detail__head"><h1 class="repo-detail__name" id="repository-detail-name">Repository</h1><span class="repo-detail__state" id="repository-detail-state"></span></div>' +
  '<p hidden id="repository-detail-error" role="alert" tabindex="-1"></p>' +
  '<dl class="repo-detail__meta" id="repository-detail-meta"></dl>' +
  '<div class="repo-detail__actions" id="repository-detail-actions"></div>' +
  '<output class="repo-detail__result" aria-live="polite" id="repository-detail-result" tabindex="-1"></output>' +
  '<section class="qb-region qb-deep-surface repo-detail__guidance" aria-labelledby="repository-detail-guidance-title"><h2 id="repository-detail-guidance-title">Applicable reviews</h2><p aria-live="polite" hidden id="repository-detail-guidance-empty">No reviews apply to this repository.</p><ol class="repo-guidance" id="repository-detail-guidance"></ol><details class="repo-guidance-raw"><summary>Raw guidance document</summary><pre aria-live="polite" id="repository-detail-guidance-raw"></pre></details></section>' +
  "</section>";

const DETAIL_STYLE =
  ".repo-detail__back{display:inline-block;margin:2px 0 14px;font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--qb-muted-ink);text-decoration:none}" +
  '.repo-detail__back::before{content:"\\2039 "}' +
  ".repo-detail__back:hover{color:var(--qb-ink)}" +
  ".repo-detail__head{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}" +
  ".repo-detail__name{margin:0;font-size:clamp(1.4rem,2.4vw,1.85rem);line-height:1.15;letter-spacing:-.02em;font-weight:650;overflow-wrap:anywhere}" +
  ".repo-detail__state{color:var(--qb-muted-ink);font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".repo-detail__meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0;margin:20px 0 0;border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line)}" +
  ".repo-detail__meta>div{display:grid;gap:5px;padding:14px 22px 14px 0}" +
  ".repo-detail__meta dt{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".repo-detail__meta dd{margin:0;font-size:14px;overflow-wrap:anywhere}" +
  ".repo-detail__meta dd.mono{font-family:var(--font-mono);font-size:12px}" +
  ".repo-detail__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:22px}" +
  ".repo-detail__actions button{min-height:32px;padding:5px 14px;border-radius:6px;font-size:12px}" +
  ".repo-detail__danger{margin-left:auto}" +
  ".repo-detail__credential{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-basis:100%;margin-top:4px}" +
  ".repo-detail__credential input{min-height:32px;font-size:12px}" +
  ".repo-detail__result{display:block;margin-top:12px;font-size:12px;color:var(--qb-muted-ink)}" +
  ".repo-detail__result:empty{display:none}" +
  ".repo-guidance{list-style:none;margin:0;padding:0}" +
  ".repo-guidance__item{display:grid;gap:9px;padding:18px 0;border-top:1px solid var(--qb-line)}" +
  ".repo-guidance__item:first-child{border-top:0}" +
  ".repo-guidance__head{display:flex;align-items:center;gap:11px;flex-wrap:wrap}" +
  ".repo-guidance__name{font-size:14px;font-weight:650}" +
  ".repo-guidance__meta{color:var(--qb-muted-ink);font-size:11px}" +
  ".repo-guidance__criteria{list-style:none;margin:0;padding:0;display:grid;gap:9px}" +
  ".repo-guidance__criterion{display:grid;grid-template-columns:14px minmax(0,1fr);gap:11px;align-items:baseline}" +
  ".repo-guidance__impact{width:9px;height:9px;margin-top:4px;border:1px solid var(--qb-ink);border-radius:50%}" +
  ".repo-guidance__impact--blocking{background:var(--qb-ink)}" +
  ".repo-guidance__impact--advisory{background:transparent}" +
  ".repo-guidance__instruction{margin:0;font-size:13px;line-height:1.5}" +
  ".repo-guidance-raw{margin-top:20px;border-top:1px solid var(--qb-line);padding-top:14px}" +
  ".repo-guidance-raw>summary{cursor:pointer;color:var(--qb-muted-ink);font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;list-style:none}" +
  ".repo-guidance-raw #repository-detail-guidance-raw{max-height:280px;overflow:auto;margin:12px 0 0;padding:12px 14px;border:1px solid var(--qb-line);border-radius:6px;font-size:12px;line-height:1.5}";

const BASE_STYLE =
  "[hidden]{display:none!important}" +
  ".repo-overview{padding-top:18px}" +
  ".repo-stat-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line)}" +
  ".repo-stat{display:grid;gap:9px;padding:18px 16px 18px 0;min-width:0}" +
  ".repo-stat__label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".repo-stat__value{font-family:var(--font-mono);font-size:24px;font-weight:500;line-height:1}" +
  ".repo-stat[data-mark] .repo-stat__value{display:inline-flex;align-items:center;gap:10px}" +
  '.repo-stat[data-mark] .repo-stat__value::before{content:"";width:10px;height:10px;border:1px solid var(--qb-ink);border-radius:50%;flex:0 0 10px}' +
  '.repo-stat[data-mark="filled"] .repo-stat__value::before{background:var(--qb-ink)}' +
  '.repo-stat[data-mark="hollow"] .repo-stat__value::before{background:transparent}' +
  '.repo-stat[data-mark="dashed"] .repo-stat__value::before{background:transparent;border-style:dashed}' +
  ".repo-ledger{border-top:1px solid var(--qb-line)}" +
  ".repo-ledger__empty{margin:14px 0 0;color:var(--qb-muted-ink);font-size:13px}" +
  ".repo-row{border-bottom:1px solid var(--qb-line)}" +
  ".repo-row__summary{display:grid;grid-template-columns:16px 11px minmax(0,1.4fr) minmax(0,0.9fr) 92px minmax(0,1.2fr) 96px 128px 20px;align-items:center;gap:14px;padding:6px 4px}" +
  ".repo-row__toggle{width:24px;height:24px;padding:0;border:0;border-radius:0;background:transparent;display:grid;place-items:center;cursor:pointer}" +
  ".repo-row__toggle:hover{border-color:transparent}" +
  ".repo-row__caret{width:8px;height:8px;border-right:1.7px solid var(--qb-ink);border-bottom:1.7px solid var(--qb-ink);transform:rotate(-45deg);transition:transform .15s}" +
  '.repo-row__toggle[aria-expanded="true"] .repo-row__caret{transform:rotate(45deg)}' +
  ".repo-row__mark{width:10px;height:10px;border:1px solid var(--qb-ink);border-radius:50%}" +
  '.repo-row__mark[data-lifecycle="enabled"]{background:var(--qb-ink)}' +
  '.repo-row__mark[data-lifecycle="disabled"]{background:transparent}' +
  '.repo-row__mark[data-lifecycle="retired"]{background:transparent;border-style:dashed}' +
  '.repo-row__mark[data-health="error"]{background:var(--qb-ink);box-shadow:inset 0 0 0 2px var(--qb-canvas)}' +
  ".repo-row__identity{display:none}" +
  ".repo-row__name{min-width:0;font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;color:inherit}" +
  ".repo-row__name:hover{text-decoration:underline;text-underline-offset:3px}" +
  ".repo-row__provider{min-width:0;color:var(--qb-muted-ink);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
  ".repo-row__lifecycle{font-size:12px;text-transform:capitalize;white-space:nowrap}" +
  ".repo-row__health{min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
  '.repo-row[data-health="error"] .repo-row__health{color:var(--qb-ink);font-weight:650}' +
  ".repo-row__assignments{font-family:var(--font-mono);font-size:12px;color:var(--qb-muted-ink);white-space:nowrap}" +
  ".repo-row__verified{font-family:var(--font-mono);font-size:11px;color:var(--qb-muted-ink);white-space:nowrap}" +
  ".repo-row__open{display:grid;place-items:center;width:20px;height:24px;color:var(--qb-ink);font-size:22px;line-height:1;text-decoration:none}" +
  ".repo-row__open:hover{color:var(--qb-muted-ink)}" +
  ".repo-row__detail{padding:2px 8px 22px 42px;display:grid;gap:18px}" +
  ".repo-row__facts{grid-template-columns:max-content minmax(0,1fr);gap:7px 18px;margin:0;max-width:64ch}" +
  ".repo-row__facts dt{color:var(--qb-muted-ink);font-size:11px}" +
  ".repo-row__facts dd{margin:0;font-size:13px}" +
  ".repo-row__mono{font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}" +
  ".repo-row__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
  ".repo-row__action{min-height:30px;padding:4px 13px;border-radius:6px;font-size:12px}" +
  ".repo-row__action--danger{margin-left:auto}" +
  ".repo-row__credential{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
  ".repo-row__credential input{min-height:30px;font-size:12px}" +
  ".repo-engine{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}" +
  "@media(max-width:900px){.repo-stat-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.repo-stat{padding-right:12px}.repo-row__summary{grid-template-columns:16px 11px minmax(0,1fr) 90px 20px;gap:10px 14px}.repo-row__provider,.repo-row__health,.repo-row__assignments,.repo-row__verified{display:none}}";

const LIST_SCRIPTS =
  '<script src="/assets/github-connection-contract.js"></script>' +
  '<script src="/assets/github-connection-lifecycle-confirmation.js"></script>' +
  '<script src="/assets/github-connection-submission.js"></script>' +
  '<script src="/assets/github-connection.js"></script>' +
  '<script src="/assets/forgejo-connection-contract.js"></script>' +
  '<script src="/assets/forgejo-connection-lifecycle-confirmation.js"></script>' +
  '<script src="/assets/forgejo-connection.js"></script>' +
  '<script src="/assets/repository.js"></script>' +
  '<script src="/assets/repository-delete.js"></script>';

const DETAIL_SCRIPTS =
  '<script src="/assets/repository.js"></script>' +
  '<script src="/assets/repository-delete.js"></script>' +
  '<script src="/assets/repository-detail.js"></script>';

/**
 * Render an operator Repositories view.
 * @param {"repositories" | "repository-detail"} view
 */
export function renderRepositoryPage(view) {
  if (view === "repository-detail") {
    return Object.freeze({
      markup:
        DETAIL_SCAFFOLD +
        DETAIL_ENGINE +
        DELETE_DIALOG +
        "<style>" +
        BASE_STYLE +
        DETAIL_STYLE +
        "</style>",
      scripts: DETAIL_SCRIPTS,
    });
  }
  return Object.freeze({
    markup:
      OVERVIEW_SECTION +
      INVENTORY_SECTION +
      ENGINE_SECTION +
      DELETE_DIALOG +
      REGISTER_SECTION +
      GITHUB_SECTION +
      FORGEJO_SECTION +
      "<style>" +
      BASE_STYLE +
      "</style>",
    scripts: LIST_SCRIPTS,
  });
}
