const OVERVIEW_SECTION =
  '<section class="qb-region repo-overview" aria-labelledby="repository-overview-title"><h2 class="qb-visually-hidden" id="repository-overview-title">Overview</h2><div class="repo-stat-strip"><div class="repo-stat"><span class="repo-stat__label">Repositories</span><output class="repo-stat__value" id="repository-overview-total">—</output></div><div class="repo-stat" data-mark="filled"><span class="repo-stat__label">Enabled</span><output class="repo-stat__value" id="repository-overview-enabled">—</output></div><div class="repo-stat" data-mark="hollow"><span class="repo-stat__label">Disabled</span><output class="repo-stat__value" id="repository-overview-disabled">—</output></div><div class="repo-stat" data-mark="dashed"><span class="repo-stat__label">Retired</span><output class="repo-stat__value" id="repository-overview-retired">—</output></div><div class="repo-stat" data-mark="filled"><span class="repo-stat__label">Health errors</span><output class="repo-stat__value" id="repository-overview-errors">—</output></div></div></section>';

const INVENTORY_SECTION =
  '<section class="qb-region repo-inventory" aria-labelledby="repository-inventory-title"><h2 id="repository-inventory-title">Repository inventory</h2><table><thead><tr><th>Provider and Connection</th><th>Identity</th><th>Lifecycle</th><th>Health</th><th>Assignments</th><th>Latest verification</th></tr></thead><tbody id="repository-inventory"></tbody></table></section>';

const LIFECYCLE_FORM =
  '<form id="repository-lifecycle-form"><label for="repository-lifecycle-repository">Repository lifecycle</label><select disabled id="repository-lifecycle-repository" required></select><label for="repository-lifecycle-state">State</label><select id="repository-lifecycle-state" required><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="retired">Retired</option></select><button disabled id="repository-lifecycle-submit" type="submit">Apply lifecycle</button><button disabled id="repository-delete" type="button">Delete Repository</button><output aria-live="polite" id="repository-lifecycle-result" tabindex="-1"></output></form>';

const CREDENTIAL_FORM =
  '<form id="repository-credential-rotate-form"><label for="repository-credential-rotate-repository">Credential Repository</label><select disabled id="repository-credential-rotate-repository" required></select><label for="repository-credential-rotate-username">Replacement username</label><input autocomplete="off" id="repository-credential-rotate-username" required type="text"><label for="repository-credential-rotate-token">Replacement token</label><input autocomplete="off" id="repository-credential-rotate-token" required type="password"><button disabled id="repository-credential-rotate-submit" type="submit">Rotate credential</button><output aria-live="polite" id="repository-credential-rotate-result"></output></form>';

const MANAGE_SECTION =
  '<section class="qb-region qb-deep-surface repo-manage" aria-labelledby="repository-manage-title"><h2 id="repository-manage-title">Manage a repository</h2><div class="repo-manage__bands"><div class="repo-band"><h3 class="repo-band__title">Lifecycle and deletion</h3>' +
  LIFECYCLE_FORM +
  '</div><div class="repo-band"><h3 class="repo-band__title">Credential rotation</h3>' +
  CREDENTIAL_FORM +
  "</div></div></section>";

const DELETE_DIALOG =
  '<dialog aria-labelledby="repository-delete-confirmation-title" id="repository-delete-confirmation"><form id="repository-delete-confirmation-form"><h2 id="repository-delete-confirmation-title">Delete Repository permanently</h2><p id="repository-delete-confirmation-message"></p><label for="repository-delete-confirmation-input">Repository identity</label><input autocomplete="off" id="repository-delete-confirmation-input" required type="text"><button id="repository-delete-confirmation-cancel" type="button">Cancel</button><button id="repository-delete-confirmation-submit" type="submit">Delete permanently</button></form></dialog>';

// The guidance section opening markup is asserted verbatim by
// repository-guidance-browser-component.test.js; keep the class, aria, and
// heading exactly as written and scope styling through element ids instead.
const GUIDANCE_SECTION =
  '<section class="qb-region qb-deep-surface" aria-labelledby="repository-guidance-title"><h2 id="repository-guidance-title">Repository Guidance</h2><label for="repository-guidance-repository">Repository</label><select disabled id="repository-guidance-repository"></select><pre aria-live="polite" id="repository-guidance-document"></pre></section>';

const REGISTER_SECTION =
  '<section class="qb-region repo-register" aria-labelledby="repository-register-title"><h2 id="repository-register-title">Register HTTPS repository</h2><form id="repository-create-form"><label for="repository-url">HTTPS URL</label><input id="repository-url" name="url" required type="url"><label for="repository-username">Username</label><input autocomplete="off" id="repository-username" name="username" type="text"><label for="repository-token">Token</label><input autocomplete="off" id="repository-token" name="token" type="password"><button type="submit">Register Repository</button><output aria-live="polite" id="repository-create-result"></output></form></section>';

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

const REPOSITORY_STYLE =
  "<style>" +
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
  ".repo-inventory table{table-layout:auto}" +
  '.repo-inventory td[data-label="Provider and Connection"]{white-space:normal;font-size:12px}' +
  '.repo-inventory td[data-label="Identity"]{font-family:var(--font-mono);font-size:12px;color:var(--qb-muted-ink);white-space:normal;overflow-wrap:anywhere}' +
  '.repo-inventory td[data-label="Assignments"],.repo-inventory td[data-label="Latest verification"]{font-family:var(--font-mono);font-size:12px;color:var(--qb-muted-ink);white-space:nowrap}' +
  ".repo-inventory td[data-lifecycle]{text-transform:capitalize;white-space:nowrap}" +
  '.repo-inventory td[data-lifecycle]::before{content:"";display:inline-block;width:8px;height:8px;margin-right:9px;border:1px solid var(--qb-ink);border-radius:50%;vertical-align:middle}' +
  '.repo-inventory td[data-lifecycle="enabled"]::before{background:var(--qb-ink)}' +
  '.repo-inventory td[data-lifecycle="disabled"]::before{background:transparent}' +
  '.repo-inventory td[data-lifecycle="retired"]::before{background:transparent;border-style:dashed}' +
  '.repo-inventory td[data-health="error"]{color:var(--qb-ink);font-weight:650}' +
  "#repository-guidance-repository{max-width:34rem}" +
  "#repository-guidance-document{max-height:320px;overflow:auto;margin:14px 0 0;padding:14px 16px;border:1px solid var(--qb-line);border-radius:6px;font-size:12px;line-height:1.5}" +
  "#repository-guidance-document:empty{display:none}" +
  ".repo-manage__bands{display:grid;gap:28px}" +
  ".repo-band__title{margin:0 0 14px;font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--qb-muted-ink)}" +
  ".repo-band form{padding:0}" +
  "@media(max-width:900px){.repo-stat-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.repo-stat{padding-right:12px}}" +
  "@media(max-width:40rem){.repo-inventory td{position:relative}.repo-inventory td::before{content:attr(data-label);display:block;margin-bottom:3px;color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}}" +
  "</style>";

const REPOSITORY_SCRIPTS =
  '<script src="/assets/github-connection-contract.js"></script>' +
  '<script src="/assets/github-connection-lifecycle-confirmation.js"></script>' +
  '<script src="/assets/github-connection-submission.js"></script>' +
  '<script src="/assets/github-connection.js"></script>' +
  '<script src="/assets/forgejo-connection-contract.js"></script>' +
  '<script src="/assets/forgejo-connection-lifecycle-confirmation.js"></script>' +
  '<script src="/assets/forgejo-connection.js"></script>' +
  '<script src="/assets/repository.js"></script>' +
  '<script src="/assets/repository-delete.js"></script>' +
  '<script src="/assets/repository-guidance.js"></script>';

/**
 * Render the operator Repositories view: an overview strip, the repository
 * inventory, a management workbench, guidance, HTTPS registration, and the
 * provider connection panels.
 */
export function renderRepositoryPage() {
  return Object.freeze({
    markup:
      OVERVIEW_SECTION +
      INVENTORY_SECTION +
      MANAGE_SECTION +
      DELETE_DIALOG +
      GUIDANCE_SECTION +
      REGISTER_SECTION +
      GITHUB_SECTION +
      FORGEJO_SECTION +
      REPOSITORY_STYLE,
    scripts: REPOSITORY_SCRIPTS,
  });
}
