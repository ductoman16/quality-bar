import assert from "node:assert/strict";

/** @param {string} page */
export function assertForgejoPage(page) {
  assert.match(page, /<form hidden id="forgejo-connection-form">/);
  assert.match(
    page,
    /<fieldset disabled id="forgejo-connection-repository-fieldset"><legend>Forgejo Repositories<\/legend><div id="forgejo-connection-repositories"><\/div><\/fieldset>.*aria-live="polite" id="forgejo-connection-status" tabindex="-1".*role="alert" tabindex="-1"/,
  );
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
}

/** @param {Map<string, any>} controls */
export function assertRegisteredForgejoState(controls) {
  assert.equal(controls.get("forgejo-connection-status").focused, true);
  assert.equal(controls.get("forgejo-connection-token").value, "");
  assert.equal(controls.get("forgejo-connection-delete").hidden, true);
  assert.match(
    controls.get("forgejo-connection-profile").textContent,
    /forgejo-v16; compatible; 16\.0\.4/,
  );
  assert.match(
    controls.get("forgejo-connection-scopes").textContent,
    /read:repository/,
  );
  assert.match(
    controls.get("forgejo-connection-capabilities").textContent,
    /private git read: verified/,
  );
  const history = controls.get("forgejo-connection-history");
  assert.equal(history.children.length, 1);
  assert.match(history.children[0].textContent, /onboarding/);
  assert.match(history.children[0].textContent, /operator \(7\)/);
  assert.match(history.children[0].textContent, /operator\/private: success/);
  const polling = controls.get("forgejo-connection-polling");
  assert.equal(polling.children.length, 1);
  assert.match(polling.children[0].textContent, /baseline complete/);
  assert.match(polling.children[0].textContent, /next attempt/);
}

/** @param {{controls: Map<string, any>, currentFailure: {value: Error | undefined}, ready: () => void}} input */
export async function assertForgejoLoadFailureState({
  controls,
  currentFailure,
  ready,
}) {
  controls.get("forgejo-connection-details").hidden = false;
  controls.get("forgejo-connection-lifecycle-form").hidden = false;
  currentFailure.value = new Error("Forgejo Connection load unavailable");
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controls.get("forgejo-connection-details").hidden, true);
  assert.equal(controls.get("forgejo-connection-form").hidden, true);
  assert.equal(controls.get("forgejo-connection-lifecycle-form").hidden, true);
  assert.equal(
    controls.get("forgejo-connection-error").textContent,
    "Forgejo Connection load unavailable",
  );
}

/** @param {{confirmationForm: any, controls: Map<string, any>, currentResponse: {value: unknown}, lifecycleJsonFailure: {value: boolean}}} input */
export async function assertUncertainForgejoRetirementState({
  confirmationForm,
  controls,
  currentResponse,
  lifecycleJsonFailure,
}) {
  lifecycleJsonFailure.value = true;
  currentResponse.value = {
    ...validForgejoConnection,
    lifecycle: "retired",
  };
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(
    controls.get("forgejo-connection-lifecycle").textContent,
    "Retired",
  );
  assert.equal(
    controls.get("forgejo-connection-reactivation-form").hidden,
    false,
  );
  assert.equal(
    controls.get("forgejo-connection-error").textContent,
    "Unexpected token < in JSON",
  );
  lifecycleJsonFailure.value = false;
}

/** @param {{confirmationForm: any, confirmationInput: any, controls: Map<string, any>, remove: any, requests: any[], retire: any, rotationForm: any, rotationResponse: {value: unknown}, rotationToken: any, status: any}} input */
export async function assertNeverUsedForgejoDeletion({
  confirmationForm,
  confirmationInput,
  controls,
  remove,
  requests,
  retire,
  rotationForm,
  rotationResponse,
  rotationToken,
  status,
}) {
  rotationResponse.value = neverUsedForgejoConnection();
  rotationToken.value = "never-used-connection-pat";
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(remove.hidden, false);
  assert.equal(retire.hidden, true);
  await remove.listener("click")({});
  assert.equal(confirmationInput.focused, true);
  confirmationInput.value = "delete";
  const requestCount = requests.length;
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(requests.length, requestCount);
  assert.equal(confirmationInput.focused, true);
  confirmationInput.value = "DELETE";
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(controls.get("forgejo-connection-details").hidden, true);
  assert.equal(controls.get("forgejo-connection-form").hidden, false);
  assert.equal(status.textContent, "Forgejo Connection deleted.");
}

/** @param {any[]} requests */
export function assertForgejoReactivationRequest(requests) {
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    token: "reactivation-pat",
  });
  assert.equal(requests.at(-1).path, "/api/v1/forgejo-connections/reactivate");
}

export const validForgejoConnection = {
  api_profile: "forgejo-v16",
  base_url: "https://forgejo.example",
  capabilities: { private_git_read: "verified" },
  health: "healthy",
  health_error: null,
  id: "forgejo-connection",
  lifecycle: "enabled",
  polling: [
    {
      baseline_status: "complete",
      error: null,
      forge_repository_id: 11,
      last_success_at: 1_000,
      next_attempt_at: 61_000,
      rate_gate_until: null,
    },
  ],
  polling_failure: null,
  principal: { id: 7, login: "operator" },
  reported_version: "16.0.4",
  scopes: ["read:repository", "write:issue", "write:repository"],
  verification_history: [
    {
      api_profile: "forgejo-v16",
      capabilities: { private_git_read: "verified" },
      error: null,
      id: "verification-1",
      outcome: "success",
      principal: { id: 7, login: "operator" },
      reported_version: "16.0.4",
      repositories: [
        {
          api_url: "https://forgejo.example/api/v1/repos/operator/private",
          clone_url: "https://forgejo.example/operator/private.git",
          full_name: "operator/private",
          html_url: "https://forgejo.example/operator/private",
          id: 11,
          outcome: "success",
          permissions: { admin: true, pull: true, push: true },
          private: true,
        },
      ],
      scopes: ["read:repository", "write:issue", "write:repository"],
      trigger: "onboarding",
      verified_at: 1_000,
    },
  ],
  verified_at: 1_000,
};

/** @param {any} valid */
export function malformedForgejoConnectionResponses(valid) {
  const verification = valid.verification_history[0];
  const repository = verification.repositories[0];
  const failedVerification =
    failedForgejoReactivation().verification_history.at(-1);
  return [
    null,
    [],
    { ...valid, api_profile: "forgejo-v17" },
    { ...valid, base_url: "" },
    { ...valid, capabilities: null },
    { ...valid, capabilities: [] },
    { ...valid, health: "error" },
    { ...valid, health_error: { code: "stale" } },
    { ...valid, id: "" },
    { ...valid, lifecycle: "unknown" },
    { ...valid, principal: null },
    { ...valid, principal: { id: "7", login: "operator" } },
    { ...valid, principal: { id: 7, login: "" } },
    { ...valid, reported_version: "17.0.0" },
    { ...valid, scopes: {} },
    { ...valid, scopes: [1] },
    { ...valid, verification_history: [] },
    { ...valid, verification_history: [{ unexpected: true }] },
    {
      ...valid,
      verification_history: [
        { ...verification, repositories: [{ id: 11, outcome: "success" }] },
      ],
    },
    {
      ...valid,
      verification_history: [
        {
          ...verification,
          repositories: [{ forge_repository_id: 11, outcome: "not_completed" }],
        },
      ],
    },
    {
      ...valid,
      verification_history: [
        {
          ...verification,
          repositories: [{ ...repository, unexpected: true }],
        },
      ],
    },
    {
      ...valid,
      verification_history: [
        {
          ...verification,
          repositories: [{ ...repository, api_url: "not a URI" }],
        },
      ],
    },
    {
      ...valid,
      verification_history: [
        { ...failedVerification, api_profile: { unexpected: true } },
      ],
    },
    {
      ...valid,
      verification_history: [{ ...failedVerification, error: null }],
    },
    {
      ...valid,
      verification_history: [{ ...failedVerification, principal: { id: 7 } }],
    },
    {
      ...valid,
      verification_history: [{ ...failedVerification, scopes: {} }],
    },
    {
      ...valid,
      verification_history: [{ ...failedVerification, capabilities: [] }],
    },
    { ...valid, verified_at: "now" },
    { ...valid, unexpected: true },
  ];
}

export function failedForgejoReactivation() {
  return {
    ...validForgejoConnection,
    health: "error",
    health_error: {
      code: "forgejo_verification_failed",
      message: "Replacement PAT verification failed",
    },
    lifecycle: "retired",
    verification_history: [
      ...validForgejoConnection.verification_history,
      {
        api_profile: null,
        capabilities: null,
        error: {
          code: "forgejo_verification_failed",
          message: "Replacement PAT verification failed",
        },
        id: "verification-2",
        outcome: "error",
        principal: null,
        reported_version: null,
        repositories: [{ forge_repository_id: 11, outcome: "not_completed" }],
        scopes: null,
        trigger: "enablement",
        verified_at: 2_000,
      },
    ],
    verified_at: 2_000,
  };
}

export function neverUsedForgejoConnection() {
  return {
    ...validForgejoConnection,
    verification_history: validForgejoConnection.verification_history.map(
      (verification) => ({ ...verification, repositories: [] }),
    ),
  };
}

/** @param {any} contract */
export async function assertForgejoContract(contract) {
  assert.equal(
    await contract.forgejoResponseErrorMessage({
      async json() {
        return { error: { message: "Exact lifecycle conflict" } };
      },
    }),
    "Exact lifecycle conflict",
  );
  await assert.rejects(
    () =>
      contract.forgejoResponseErrorMessage({
        async json() {
          return { error: {} };
        },
      }),
    /Forgejo error response is invalid/,
  );
  assert.equal(
    contract.forgejoErrorMessage(new Error("Exact browser failure")),
    "Exact browser failure",
  );
  assert.throws(
    () => contract.forgejoErrorMessage("unexpected thrown value"),
    (error) => error === "unexpected thrown value",
  );
  assert.equal(
    contract.forgejoPollingText({
      baseline_status: "complete",
      error: {
        code: "forgejo_api_rate_limited",
        message: "Forgejo polling rate limited",
      },
      forge_repository_id: 11,
      last_success_at: 1_000,
      next_attempt_at: 125_000,
      rate_gate_until: 125_000,
    }),
    "Forge Repository 11; baseline complete; 1970-01-01T00:00:01.000Z; Forgejo polling rate limited (forgejo_api_rate_limited); rate gate until 1970-01-01T00:02:05.000Z; next attempt 1970-01-01T00:02:05.000Z",
  );
  assert.match(
    contract.forgejoVerificationText({
      error: { code: "forgejo_failed", message: "Forgejo failed" },
      outcome: "error",
      repositories: [],
      trigger: "enablement",
      verified_at: 2_000,
    }),
    /Forgejo failed \(forgejo_failed\)/,
  );
}

/** @param {Map<string, any>} controls */
export function assertFailedForgejoReactivationState(controls) {
  const lifecycle = controls.get("forgejo-connection-lifecycle");
  const health = controls.get("forgejo-connection-health");
  const history = controls.get("forgejo-connection-history");
  const error = controls.get("forgejo-connection-error");
  const profile = controls.get("forgejo-connection-profile");
  const token = controls.get("forgejo-connection-reactivation-token");
  const submit = controls.get("forgejo-connection-reactivation-submit");
  assert.equal(lifecycle.textContent, "Retired");
  assert.match(health.textContent, /Replacement PAT verification failed/);
  assert.equal(history.children.length, 2);
  assert.equal(error.textContent, "Replacement PAT verification failed");
  assert.match(profile.textContent, /Last successful: forgejo-v16/);
  assert.doesNotMatch(profile.textContent, /compatible/);
  assert.equal(token.value, "failed-reactivation-pat");
  assert.equal(submit.disabled, false);
}
