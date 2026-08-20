<script setup>
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import {
  csrfRequest,
  repositoryCollection,
  requireStatus,
  responseMessage,
} from "../browser.js";
import ConnectionLifecycleDialog from "./ConnectionLifecycleDialog.vue";
import ConnectionLifecycleActions from "./ConnectionLifecycleActions.vue";
import GitHubManifestContinuation from "./GitHubManifestContinuation.vue";
import ProviderConnectionFacts from "./ProviderConnectionFacts.vue";
import {
  forgejoConnectionUsed,
  validForgejoChoices,
  validForgejoConnection,
  validGitHubConnection,
  validManifestContinuation,
} from "./contract.js";
import {
  githubRepositoryChoices,
  reconciledGitHubSelection,
  registerGitHubSelection,
} from "./github-selection.js";
import { requestConnectionLifecycle } from "./provider-lifecycle.js";
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
  statusElement = ref(),
  lifecycleDialog = ref(),
  busy = ref(false);
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
const failureMessage = (failure, fallback) =>
  failure instanceof Error ? failure.message : fallback;
async function safe(action) {
  if (busy.value) return;
  busy.value = true;
  emit("error", "");
  status.value = "";
  try {
    await action();
  } catch (failure) {
    emit("error", failureMessage(failure, "connection_request_failed"));
  } finally {
    busy.value = false;
  }
}
async function announce(message) {
  status.value = message;
  await nextTick();
  statusElement.value?.focus();
}
const load = () => Promise.all(["github", "forgejo"].map(loadProvider));
const githubChoices = computed(() => githubRepositoryChoices(github.value));
async function loadProvider(provider) {
  const target = provider === "github" ? github : forgejo;
  const validate =
    provider === "github" ? validGitHubConnection : validForgejoConnection;
  const response = await fetch(`/api/v1/${provider}-connections`);
  await requireStatus(response, 200, "connection_response_invalid");
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
  await requireStatus(response, 200, "github_manifest_response_invalid");
  if (reactivating) {
    const value = await response.json();
    if (value === null || !validGitHubConnection(value))
      throw new Error("GitHub Connection response is invalid");
    github.value = value;
    githubPem.value = "";
    await announce("GitHub Connection reactivated.");
    return;
  }
  const body = await response.json();
  if (!validManifestContinuation(body))
    throw new Error("GitHub App Manifest response is invalid");
  manifest.value = body;
}
async function registerGitHubRepositories() {
  if (!githubSelected.size)
    throw new Error("Select at least one GitHub Repository");
  const selected = [...githubSelected];
  const result = await registerGitHubSelection(props.csrfCookieName, selected);
  if (result.response) {
    await Promise.all([loadProvider("github"), repositoryCollection()]);
    throw new Error(await responseMessage(result.response));
  }
  if (!result.registered) {
    const repositories = await Promise.all([
      loadProvider("github"),
      repositoryCollection(),
    ]).then((values) => values[1]);
    if (
      reconciledGitHubSelection(
        github.value,
        repositories,
        selected,
        result.requestId,
      )
    ) {
      await announce("GitHub Repositories registered.");
      emit("changed");
      return;
    }
    throw new Error(result.message);
  }
  await announce("GitHub Repositories registered.");
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
  await requireStatus(response, 200, "github_rotation_response_invalid");
  const value = await response.json();
  if (value === null || !validGitHubConnection(value))
    throw new Error("GitHub Connection response is invalid");
  github.value = value;
  githubPem.value = "";
  await announce(
    "GitHub App credentials rotated. Revoke the predecessor in GitHub.",
  );
}
async function discoverForgejo() {
  const response = await request("/api/v1/forgejo-connections/discover", {
    base_url: forge.baseUrl,
    token: forge.token,
  });
  await requireStatus(response, 200, "forgejo_verification_response_invalid");
  const choices = await response.json();
  if (!validForgejoChoices(choices))
    throw new Error("Forgejo verification response is invalid");
  forge.choices = choices;
  forge.selected.clear();
  await announce("Forgejo Repositories verified.");
}
async function connectForgejo() {
  if (!forge.selected.size)
    throw new Error("Select at least one Forgejo Repository");
  const response = await request("/api/v1/forgejo-connections", {
    base_url: forge.baseUrl,
    repository_ids: [...forge.selected],
    token: forge.token,
  });
  await requireStatus(response, 201, "forgejo_connection_response_invalid");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    throw new Error("Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.token = "";
  await announce("Forgejo Connection verified.");
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
  await requireStatus(response, 200, "forgejo_rotation_response_invalid");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    throw new Error("Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.rotationToken = "";
  await announce("Forgejo PAT rotated. Revoke its predecessor in Forgejo.");
}
async function reactivateForgejo() {
  const response = await request("/api/v1/forgejo-connections/reactivate", {
    token: forge.reactivationToken,
  });
  await requireStatus(response, 200, "forgejo_reactivation_response_invalid");
  const value = await response.json();
  if (value === null || !validForgejoConnection(value))
    throw new Error("Forgejo Connection response is invalid");
  forgejo.value = value;
  forge.reactivationToken = "";
  await announce("Forgejo Connection reactivated.");
}
const openLifecycle = (provider, method, identity) =>
  lifecycleDialog.value.open(provider, method, identity);
async function lifecycle({ method, provider }) {
  const lower = provider.toLowerCase();
  try {
    const current = await requestConnectionLifecycle(
      props.csrfCookieName,
      lower,
      method,
    );
    (lower === "github" ? github : forgejo).value = current;
    await announce(
      `${provider} Connection ${method === "DELETE" ? "deleted" : "retired"}.`,
    );
    emit("changed");
  } catch (failure) {
    const message = failureMessage(failure, "Connection lifecycle failed");
    try {
      await loadProvider(lower);
    } catch (refreshFailure) {
      (lower === "github" ? github : forgejo).value = null;
      throw new Error(
        `${message}; ${failureMessage(refreshFailure, "Connection refresh failed")}`,
      );
    }
    throw new Error(message);
  }
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
        v-if="githubChoices.length && github.lifecycle !== 'retired'"
        @submit.prevent="safe(registerGitHubRepositories)"
      >
        <fieldset>
          <legend>GitHub Repositories</legend>
          <label v-for="item in githubChoices" :key="item.id"
            ><input
              type="checkbox"
              :checked="githubSelected.has(item.id)"
              @change="
                $event.target.checked
                  ? githubSelected.add(item.id)
                  : githubSelected.delete(item.id)
              "
            />{{ item.full_name }};
            {{
              item.verification_required
                ? "verification required"
                : item.private
                  ? "private"
                  : "public"
            }}</label
          >
        </fieldset>
        <button type="submit">Register selected Repositories</button>
      </form>
      <ConnectionLifecycleActions
        :connection="github"
        provider="GitHub"
        @open="openLifecycle"
      />
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
      <ConnectionLifecycleActions
        :connection="forgejo"
        provider="Forgejo"
        :used="forgejoConnectionUsed(forgejo)"
        @open="openLifecycle"
      />
    </template>
  </section>
  <output ref="statusElement" aria-live="polite" tabindex="-1">{{
    status
  }}</output>
  <ConnectionLifecycleDialog
    ref="lifecycleDialog"
    @change="safe(() => lifecycle($event))"
  />
</template>
