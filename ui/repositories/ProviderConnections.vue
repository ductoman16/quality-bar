<script setup>
import { onMounted, reactive, ref } from "vue";
import { csrfRequest, responseMessage } from "../browser.js";
import ConnectionLifecycleDialog from "./ConnectionLifecycleDialog.vue";
import GitHubManifestContinuation from "./GitHubManifestContinuation.vue";
import ProviderConnectionFacts from "./ProviderConnectionFacts.vue";
import {
  validForgejoChoices,
  validForgejoConnection,
  validGitHubConnection,
  validManifestContinuation,
} from "./contract.js";
import { registerGitHubSelection } from "./github-selection.js";
const props = defineProps({ csrfCookieName: { required: true, type: String } });
const emit = defineEmits(["changed", "error"]);
const github = ref(null),
  forgejo = ref(null),
  githubPem = ref(""),
  githubSelected = reactive(new Set()),
  manifest = ref();
const forge = reactive({
  baseUrl: "",
  choices: [],
  reactivationToken: "",
  rotationToken: "",
  selected: new Set(),
  token: "",
});
const status = ref(""),
  lifecycleDialog = ref(),
  busy = ref(false);
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
async function fail(response, fallback) {
  throw new Error(response ? await responseMessage(response) : fallback);
}
async function requireResponse(response, expected, label) {
  if (!response.ok) await fail(response, `${label} failed`);
  if (response.status !== expected)
    await fail(null, `${label} response is invalid`);
}
async function safe(action) {
  if (busy.value) return;
  busy.value = true;
  emit("error", "");
  try {
    await action();
  } catch (failure) {
    emit(
      "error",
      failure instanceof Error ? failure.message : "connection_request_failed",
    );
  } finally {
    busy.value = false;
  }
}
const load = () =>
  Promise.all([loadProvider("github"), loadProvider("forgejo")]);
async function loadProvider(provider) {
  const target = provider === "github" ? github : forgejo;
  const validate =
    provider === "github" ? validGitHubConnection : validForgejoConnection;
  const response = await fetch(`/api/v1/${provider}-connections`);
  await requireResponse(response, 200, "Connection loading");
  const value = await response.json();
  if (!validate(value)) throw new Error("connection_response_invalid");
  target.value = value;
}
async function startGitHub() {
  const reactivating = github.value?.lifecycle === "retired";
  const response = await request(
    reactivating
      ? "/api/v1/github-connections/reactivate"
      : "/api/v1/github-connections/manifest",
    reactivating ? { pem: githubPem.value } : {},
  );
  await requireResponse(response, 200, "GitHub App Manifest flow");
  if (reactivating) {
    const value = await response.json();
    if (value === null || !validGitHubConnection(value))
      return fail(null, "GitHub Connection response is invalid");
    github.value = value;
    githubPem.value = "";
    status.value = "GitHub Connection reactivated.";
    return;
  }
  const body = await response.json();
  if (!validManifestContinuation(body))
    return fail(null, "GitHub App Manifest response is invalid");
  manifest.value = body;
}
const githubChoices = () =>
  github.value?.verification_history?.at(-1)?.repositories ?? [];
async function registerGitHubRepositories() {
  if (!githubSelected.size)
    return fail(null, "Select at least one GitHub Repository");
  const result = await registerGitHubSelection(props.csrfCookieName, [
    ...githubSelected,
  ]);
  if (result.response) {
    await load();
    return fail(result.response, "GitHub Repository selection failed");
  }
  if (!result.registered) {
    await load();
    return fail(null, result.message);
  }
  status.value = "GitHub Repositories registered.";
  emit("changed");
  await load();
}
async function rotateGitHub() {
  if (
    !githubPem.value ||
    !confirm(
      "Rotate GitHub App credentials? Quality Bar will replace its old copy after verification. Revoke the predecessor in GitHub.",
    )
  )
    return;
  const response = await request(
    "/api/v1/github-connections/credential/rotate",
    { pem: githubPem.value },
  );
  await requireResponse(response, 200, "GitHub App credential rotation");
  const value = await response.json();
  if (value === null || !validGitHubConnection(value))
    return fail(null, "GitHub Connection response is invalid");
  github.value = value;
  githubPem.value = "";
  status.value =
    "GitHub App credentials rotated. Revoke the predecessor in GitHub.";
}
async function discoverForgejo() {
  const response = await request("/api/v1/forgejo-connections/discover", {
    base_url: forge.baseUrl,
    token: forge.token,
  });
  await requireResponse(response, 200, "Forgejo verification");
  const choices = await response.json();
  if (!validForgejoChoices(choices))
    return fail(null, "Forgejo verification response is invalid");
  forge.choices = choices;
  forge.selected.clear();
  status.value = "Forgejo Repositories verified.";
}
async function connectForgejo() {
  if (!forge.selected.size)
    return fail(null, "Select at least one Forgejo Repository");
  const response = await request("/api/v1/forgejo-connections", {
    base_url: forge.baseUrl,
    repository_ids: [...forge.selected],
    token: forge.token,
  });
  await requireResponse(response, 201, "Forgejo Connection");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    return fail(null, "Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.token = "";
  status.value = "Forgejo Connection verified.";
  emit("changed");
}
async function rotateForgejo() {
  if (
    !confirm(
      "Rotate Forgejo PAT? Quality Bar will replace its old copy after verification. Revoke the predecessor in Forgejo.",
    )
  )
    return;
  const response = await request(
    "/api/v1/forgejo-connections/credential/rotate",
    { token: forge.rotationToken },
  );
  await requireResponse(response, 200, "Forgejo PAT rotation");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    return fail(null, "Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.rotationToken = "";
  status.value = "Forgejo PAT rotated. Revoke its predecessor in Forgejo.";
}
async function reactivateForgejo() {
  const response = await request("/api/v1/forgejo-connections/reactivate", {
    token: forge.reactivationToken,
  });
  await requireResponse(response, 200, "Forgejo Connection reactivation");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    return fail(null, "Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.reactivationToken = "";
  status.value = "Forgejo Connection reactivated.";
}
const openLifecycle = (...args) => lifecycleDialog.value.open(...args);
async function lifecycle({ method, provider }) {
  const lower = provider.toLowerCase();
  let response;
  try {
    response = await request(
      `/api/v1/${lower}-connections/lifecycle`,
      method === "PATCH" ? { lifecycle: "retired" } : {},
      method,
    );
  } catch (failure) {
    if (!(failure instanceof TypeError)) throw failure;
    await loadProvider(lower);
    throw new Error(`${provider} Connection lifecycle request failed`);
  }
  await requireResponse(response, 200, `${provider} Connection lifecycle`);
  const current = await response.json();
  const valid =
    method === "DELETE"
      ? current === null
      : (lower === "github"
          ? validGitHubConnection(current)
          : validForgejoConnection(current)) &&
        current?.lifecycle === "retired";
  if (!valid) {
    throw new Error(`${provider} Connection lifecycle response is invalid`);
  }
  (lower === "github" ? github : forgejo).value = current;
  status.value = `${provider} Connection ${method === "DELETE" ? "deleted" : "retired"}.`;
}
onMounted(() => safe(load));
</script>
<template>
  <section id="github-connection-details" class="qb-region" :inert="busy">
    <h2>GitHub Connection</h2>
    <form
      v-if="!github || github.lifecycle === 'retired'"
      @submit.prevent="safe(startGitHub)"
    >
      <label v-if="github" for="github-pem">Replacement private key</label
      ><textarea
        v-if="github"
        id="github-pem"
        v-model="githubPem"
        required
      ></textarea
      ><button class="qb-btn qb-btn--secondary" type="submit">
        {{ github ? "Reactivate GitHub App" : "Connect GitHub App" }}
      </button>
    </form>
    <template v-if="github"
      ><ProviderConnectionFacts :connection="github" provider="GitHub" />
      <form
        v-if="github.lifecycle !== 'retired'"
        @submit.prevent="safe(rotateGitHub)"
      >
        <label for="github-rotation-pem">Replacement private key</label
        ><textarea
          id="github-rotation-pem"
          v-model="githubPem"
          required
        ></textarea
        ><button type="submit">Rotate GitHub App credentials</button>
      </form>
      <form
        v-if="githubChoices().length && github.lifecycle !== 'retired'"
        @submit.prevent="safe(registerGitHubRepositories)"
      >
        <fieldset>
          <legend>GitHub Repositories</legend>
          <label v-for="item in githubChoices()" :key="item.id"
            ><input
              type="checkbox"
              :checked="githubSelected.has(item.id)"
              @change="
                $event.target.checked
                  ? githubSelected.add(item.id)
                  : githubSelected.delete(item.id)
              "
            />{{ item.full_name }};
            {{ item.private ? "private" : "public" }}</label
          >
        </fieldset>
        <button type="submit">Register selected Repositories</button>
      </form>
      <button
        v-if="github.lifecycle !== 'retired'"
        type="button"
        @click="openLifecycle('GitHub', 'PATCH')"
      >
        Retire GitHub Connection</button
      ><button type="button" @click="openLifecycle('GitHub', 'DELETE')">
        Delete GitHub Connection
      </button>
    </template>
    <GitHubManifestContinuation
      v-if="manifest"
      :action="manifest.action"
      :manifest="manifest.manifest"
    />
  </section>
  <section id="forgejo-connection-details" class="qb-region" :inert="busy">
    <h2>Forgejo Connection</h2>
    <template v-if="!forgejo"
      ><form
        v-if="!forge.choices.length"
        id="forgejo-connection-form"
        @submit.prevent="safe(discoverForgejo)"
      >
        <label for="forgejo-connection-base-url">Forgejo URL</label
        ><input
          id="forgejo-connection-base-url"
          v-model="forge.baseUrl"
          required
          type="url"
        /><label for="forgejo-connection-token">Repository-scoped PAT</label
        ><input
          id="forgejo-connection-token"
          v-model="forge.token"
          required
          type="password"
        /><button type="submit">Verify Forgejo Connection</button>
      </form>
      <form v-else @submit.prevent="safe(connectForgejo)">
        <fieldset>
          <legend>Forgejo Repositories</legend>
          <label v-for="item in forge.choices" :key="item.id"
            ><input
              type="checkbox"
              :checked="forge.selected.has(item.id)"
              @change="
                $event.target.checked
                  ? forge.selected.add(item.id)
                  : forge.selected.delete(item.id)
              "
            />{{ item.full_name }}</label
          >
        </fieldset>
        <button type="submit">Register selected Forgejo Repositories</button>
      </form></template
    >
    <template v-else
      ><ProviderConnectionFacts :connection="forgejo" provider="Forgejo" />
      <form
        v-if="forgejo.lifecycle !== 'retired'"
        @submit.prevent="safe(rotateForgejo)"
      >
        <label for="forgejo-rotation-token"
          >Replacement Repository-scoped PAT</label
        ><input
          id="forgejo-rotation-token"
          v-model="forge.rotationToken"
          required
          type="password"
        /><button type="submit">Rotate Forgejo PAT</button>
      </form>
      <form v-else @submit.prevent="safe(reactivateForgejo)">
        <label for="forgejo-reactivation-token">Reactivation PAT</label
        ><input
          id="forgejo-reactivation-token"
          v-model="forge.reactivationToken"
          required
          type="password"
        /><button type="submit">Reactivate Forgejo Connection</button>
      </form>
      <button
        v-if="forgejo.lifecycle !== 'retired'"
        type="button"
        @click="openLifecycle('Forgejo', 'PATCH')"
      >
        Retire Forgejo Connection</button
      ><button type="button" @click="openLifecycle('Forgejo', 'DELETE')">
        Delete Forgejo Connection
      </button>
    </template>
  </section>
  <output aria-live="polite">{{ status }}</output>
  <ConnectionLifecycleDialog
    ref="lifecycleDialog"
    @change="safe(() => lifecycle($event))"
  />
</template>
