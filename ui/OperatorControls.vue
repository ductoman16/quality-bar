<script setup>
import { nextTick, onMounted, onUnmounted, ref } from "vue";

import { csrfToken, requireStatus, responseMessage } from "./browser.js";
import {
  readOnboardingTokens,
  validOnboardingTokenReveal,
  validTokenReveal,
} from "./contract.js";

const props = defineProps({
  csrfCookieName: { required: true, type: String },
  showOnboarding: Boolean,
});
const error = ref("");
const errorElement = ref();
const token = ref("");
const tokenDialog = ref();
const onboardingToken = ref("");
const onboardingDialog = ref();
const onboardingTokens = ref([]);
const onboardingUrl = ref("");
const fields = ref({
  changeCurrent: "",
  changeNew: "",
  createPassword: "",
  revokeConfirmation: "",
  revokePassword: "",
  tokenRevokePassword: "",
  tokenRotatePassword: "",
});
let lastActivityAt = 0;

async function showError(message) {
  error.value = message;
  await nextTick();
  errorElement.value?.focus();
}
async function safe(action) {
  try {
    await action();
  } catch (failure) {
    await showError(
      failure instanceof Error ? failure.message : "operator_request_failed",
    );
  }
}
const failure = async (response) => showError(await responseMessage(response));
const request = (path, body, method = "POST") =>
  fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(props.csrfCookieName),
    },
    method,
  });
async function passwordMutation(path, body) {
  error.value = "";
  const response = await request(path, body);
  if (response.ok && response.status === 204) location.assign("/");
  else if (response.ok) await showError("operator_response_invalid");
  else await failure(response);
}
async function tokenMutation(path, password) {
  error.value = "";
  const response = await request(path, { password });
  if (!response.ok) return failure(response);
  if (response.status !== (path.endsWith("/rotate") ? 200 : 201))
    return showError("token_reveal_invalid");
  const value = await response.json();
  if (!validTokenReveal(value)) return showError("token_reveal_invalid");
  token.value = value.token;
  tokenDialog.value.showModal();
}
async function logout() {
  const response = await request("/api/v1/session/logout", {});
  if (response.ok && response.status === 204) location.assign("/");
  else if (response.ok) await showError("operator_response_invalid");
  else await failure(response);
}
async function activity() {
  const now = Date.now();
  if (now - lastActivityAt < 60_000) return;
  lastActivityAt = now;
  const response = await fetch("/api/v1/session/activity", {
    headers: { "x-quality-bar-csrf": csrfToken(props.csrfCookieName) },
    method: "POST",
  });
  if (!response.ok) await failure(response);
  else if (response.status !== 204)
    await showError("operator_response_invalid");
}
async function loadOnboardingTokens() {
  if (!props.showOnboarding) return;
  const response = await fetch("/api/v1/onboarding-tokens");
  await requireStatus(response, 200, "onboarding_token_collection_invalid");
  try {
    onboardingTokens.value = readOnboardingTokens(await response.json());
  } catch {
    await showError("onboarding_token_collection_invalid");
  }
}
async function createOnboardingToken() {
  const response = await request("/api/v1/onboarding-tokens", {
    repository_url: onboardingUrl.value,
  });
  if (!response.ok) return failure(response);
  if (response.status !== 201)
    return showError("onboarding_token_reveal_invalid");
  const value = await response.json();
  if (!validOnboardingTokenReveal(value))
    return showError("onboarding_token_reveal_invalid");
  onboardingToken.value = value.token;
  onboardingUrl.value = "";
  onboardingDialog.value.showModal();
  await loadOnboardingTokens();
}
async function revokeOnboardingToken(id) {
  const response = await request(
    `/api/v1/onboarding-tokens/${encodeURIComponent(id)}`,
    {},
    "DELETE",
  );
  if (response.ok && response.status === 204) await loadOnboardingTokens();
  else if (response.ok) await showError("onboarding_token_response_invalid");
  else await failure(response);
}
const recordActivity = () => void safe(activity);
onMounted(() => {
  document.addEventListener("keydown", recordActivity);
  document.addEventListener("pointerdown", recordActivity);
  void safe(loadOnboardingTokens);
});
onUnmounted(() => {
  document.removeEventListener("keydown", recordActivity);
  document.removeEventListener("pointerdown", recordActivity);
});
</script>

<template>
  <details>
    <summary>Operator</summary>
    <form
      @submit.prevent="
        safe(() =>
          passwordMutation('/api/v1/session/password', {
            current_password: fields.changeCurrent,
            new_password: fields.changeNew,
          }),
        )
      "
    >
      <label for="password-change-current-password"
        >Current password for password change</label
      ><input
        id="password-change-current-password"
        v-model="fields.changeCurrent"
        autocomplete="current-password"
        required
        type="password"
      />
      <label for="password-change-new-password">New password</label
      ><input
        id="password-change-new-password"
        v-model="fields.changeNew"
        autocomplete="new-password"
        required
        type="password"
      />
      <button type="submit">Change password</button>
    </form>
    <form
      @submit.prevent="
        safe(() =>
          passwordMutation('/api/v1/sessions/revoke', {
            confirmation: fields.revokeConfirmation,
            password: fields.revokePassword,
          }),
        )
      "
    >
      <label for="session-revocation-password"
        >Current password for session revocation</label
      ><input
        id="session-revocation-password"
        v-model="fields.revokePassword"
        autocomplete="current-password"
        required
        type="password"
      />
      <label for="session-revocation-confirmation"
        >Confirmation: REVOKE ALL SESSIONS</label
      ><input
        id="session-revocation-confirmation"
        v-model="fields.revokeConfirmation"
        required
      />
      <button type="submit">Revoke all sessions</button>
    </form>
    <form
      @submit.prevent="
        safe(() =>
          tokenMutation('/api/v1/implementer-token', fields.createPassword),
        )
      "
    >
      <label for="implementer-token-create-password"
        >Current password for implementer token creation</label
      ><input
        id="implementer-token-create-password"
        v-model="fields.createPassword"
        autocomplete="current-password"
        required
        type="password"
      /><button type="submit">Create implementer token</button>
    </form>
    <form
      @submit.prevent="
        safe(() =>
          tokenMutation(
            '/api/v1/implementer-token/rotate',
            fields.tokenRotatePassword,
          ),
        )
      "
    >
      <label for="implementer-token-rotate-password"
        >Current password for implementer token rotation</label
      ><input
        id="implementer-token-rotate-password"
        v-model="fields.tokenRotatePassword"
        autocomplete="current-password"
        required
        type="password"
      /><button type="submit">Rotate implementer token</button>
    </form>
    <form
      @submit.prevent="
        confirm(
          'Revoke implementer token? Machine access will remain disabled until a new token is created.',
        ) &&
        safe(() =>
          passwordMutation('/api/v1/implementer-token/revoke', {
            password: fields.tokenRevokePassword,
          }),
        )
      "
    >
      <label for="implementer-token-revoke-password"
        >Current password for implementer token revocation</label
      ><input
        id="implementer-token-revoke-password"
        v-model="fields.tokenRevokePassword"
        autocomplete="current-password"
        required
        type="password"
      /><button type="submit">Revoke implementer token</button>
    </form>
    <section v-if="showOnboarding" aria-labelledby="onboarding-tokens-title">
      <h2 id="onboarding-tokens-title">Onboarding tokens</h2>
      <form @submit.prevent="safe(createOnboardingToken)">
        <label for="onboarding-token-repository-url">Repository URL</label
        ><input
          id="onboarding-token-repository-url"
          v-model="onboardingUrl"
          required
          type="url"
        /><button type="submit">Create onboarding token</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Expires</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in onboardingTokens" :key="item.id">
            <td>{{ item.repository_url }}</td>
            <td>{{ new Date(item.expires_at).toLocaleString() }}</td>
            <td>
              <button
                type="button"
                @click="safe(() => revokeOnboardingToken(item.id))"
              >
                Revoke
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <button type="button" @click="safe(logout)">Log out</button>
  </details>
  <dialog
    ref="tokenDialog"
    aria-labelledby="implementer-token-reveal-title"
    @close="token = ''"
  >
    <h2 id="implementer-token-reveal-title">Implementer token</h2>
    <output>{{ token }}</output
    ><button type="button" @click="tokenDialog.close()">Done</button>
  </dialog>
  <dialog
    ref="onboardingDialog"
    aria-labelledby="onboarding-token-reveal-title"
    @close="onboardingToken = ''"
  >
    <h2 id="onboarding-token-reveal-title">Onboarding token</h2>
    <output>{{ onboardingToken }}</output>
    <p role="status">Shown once.</p>
    <button type="button" @click="onboardingDialog.close()">Done</button>
  </dialog>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">{{ error }}</p>
</template>
