<script setup>
import { nextTick, onMounted, reactive, ref } from "vue";

import { csrfRequest, responseMessage } from "../browser.js";
import GitHubManifestContinuation from "./GitHubManifestContinuation.vue";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const emit = defineEmits(["changed", "error"]);
const github = ref(null),
  forgejo = ref(null),
  githubPem = ref(""),
  githubSelected = reactive(new Set()),
  manifest = ref(),
  error = ref("");
const forge = reactive({
  baseUrl: "",
  choices: [],
  reactivationToken: "",
  rotationToken: "",
  selected: new Set(),
  token: "",
});
const status = ref("");
const confirmation = reactive({
  body: {},
  method: "PATCH",
  provider: "",
  text: "",
});
const confirmationDialog = ref(),
  confirmationInput = ref();
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
async function fail(response, fallback) {
  error.value = response ? await responseMessage(response, fallback) : fallback;
  emit("error", error.value);
}
async function load() {
  for (const [path, target] of [
    ["/api/v1/github-connections", github],
    ["/api/v1/forgejo-connections", forgejo],
  ]) {
    try {
      const response = await fetch(path);
      if (!response.ok) await fail(response, "Connection loading failed");
      else target.value = await response.json();
    } catch {
      await fail(null, "Connection loading failed");
    }
  }
}
async function startGitHub() {
  const reactivating = github.value?.lifecycle === "retired";
  const response = await request(
    reactivating
      ? "/api/v1/github-connections/reactivate"
      : "/api/v1/github-connections/manifest",
    reactivating ? { pem: githubPem.value } : {},
  );
  if (!response.ok)
    return fail(response, "GitHub App Manifest flow could not start");
  if (reactivating) {
    github.value = await response.json();
    githubPem.value = "";
    status.value = "GitHub Connection reactivated.";
    return;
  }
  const body = await response.json();
  if (
    body.method !== "POST" ||
    typeof body.action !== "string" ||
    !body.manifest
  )
    return fail(null, "GitHub App Manifest response is invalid");
  manifest.value = body;
}
const githubChoices = () =>
  github.value?.verification_history?.at(-1)?.repositories ?? [];
async function registerGitHubRepositories() {
  if (!githubSelected.size)
    return fail(null, "Select at least one GitHub Repository");
  const response = await request("/api/v1/github-connections/repositories", {
    repository_ids: [...githubSelected],
    request_id: crypto.randomUUID(),
  });
  if (!response.ok) return fail(response, "GitHub Repository selection failed");
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
  if (!response.ok)
    return fail(response, "GitHub App credential rotation failed");
  github.value = await response.json();
  githubPem.value = "";
  status.value =
    "GitHub App credentials rotated. Revoke the predecessor in GitHub.";
}
async function discoverForgejo() {
  const response = await request("/api/v1/forgejo-connections/discover", {
    base_url: forge.baseUrl,
    token: forge.token,
  });
  if (!response.ok) return fail(response, "Forgejo verification failed");
  forge.choices = await response.json();
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
  if (!response.ok) return fail(response, "Forgejo registration failed");
  forgejo.value = await response.json();
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
  if (!response.ok) return fail(response, "Forgejo PAT rotation failed");
  forgejo.value = await response.json();
  forge.rotationToken = "";
  status.value = "Forgejo PAT rotated. Revoke its predecessor in Forgejo.";
}
async function reactivateForgejo() {
  const response = await request("/api/v1/forgejo-connections/reactivate", {
    token: forge.reactivationToken,
  });
  if (!response.ok)
    return fail(response, "Forgejo Connection reactivation failed");
  forgejo.value = await response.json();
  forge.reactivationToken = "";
  status.value = "Forgejo Connection reactivated.";
}
function openLifecycle(provider, method) {
  confirmation.provider = provider;
  confirmation.method = method;
  confirmation.body = method === "PATCH" ? { lifecycle: "retired" } : {};
  confirmation.text = "";
  confirmationDialog.value.showModal();
  if (method === "DELETE") nextTick(() => confirmationInput.value.focus());
}
async function lifecycle() {
  if (confirmation.method === "DELETE" && confirmation.text !== "DELETE") {
    emit(
      "error",
      `Type DELETE to confirm permanent ${confirmation.provider} Connection deletion`,
    );
    confirmationInput.value.focus();
    return;
  }
  confirmationDialog.value.close();
  const lower = confirmation.provider.toLowerCase();
  const response = await request(
    `/api/v1/${lower}-connections/lifecycle`,
    confirmation.body,
    confirmation.method,
  );
  if (!response.ok)
    return fail(
      response,
      `${confirmation.provider} Connection lifecycle failed`,
    );
  if (lower === "github")
    github.value =
      confirmation.method === "DELETE" ? null : await response.json();
  else
    forgejo.value =
      confirmation.method === "DELETE" ? null : await response.json();
  status.value = `${confirmation.provider} Connection ${confirmation.method === "DELETE" ? "deleted" : "retired"}.`;
}
onMounted(load);
</script>

<template>
  <section class="qb-region">
    <h2>GitHub Connection</h2>
    <form
      v-if="!github || github.lifecycle === 'retired'"
      @submit.prevent="startGitHub"
    >
      <label v-if="github" for="github-pem">Replacement private key</label
      ><textarea
        v-if="github"
        id="github-pem"
        v-model="githubPem"
        required
      ></textarea
      ><button class="qb-btn qb-btn--primary" type="submit">
        {{ github ? "Reactivate GitHub App" : "Connect GitHub App" }}
      </button>
    </form>
    <template v-if="github"
      ><dl>
        <dt>Identity</dt>
        <dd>{{ github.principal?.login }}</dd>
        <dt>Lifecycle</dt>
        <dd>{{ github.lifecycle }}</dd>
        <dt>Health</dt>
        <dd>{{ github.health_error?.message || github.health }}</dd>
        <dt>Permissions</dt>
        <dd>
          {{
            Object.entries(github.permissions || {})
              .map(([name, value]) => `${name}: ${value}`)
              .join("; ")
          }}
        </dd>
      </dl>
      <form
        v-if="github.lifecycle !== 'retired'"
        @submit.prevent="rotateGitHub"
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
        @submit.prevent="registerGitHubRepositories"
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
  <section class="qb-region">
    <h2>Forgejo Connection</h2>
    <template v-if="!forgejo"
      ><form
        v-if="!forge.choices.length"
        id="forgejo-connection-form"
        @submit.prevent="discoverForgejo"
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
      <form v-else @submit.prevent="connectForgejo">
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
      ><dl>
        <dt>Repository owner</dt>
        <dd>{{ forgejo.principal?.login }}</dd>
        <dt>Lifecycle</dt>
        <dd>{{ forgejo.lifecycle }}</dd>
        <dt>Health</dt>
        <dd>{{ forgejo.health_error?.message || forgejo.health }}</dd>
      </dl>
      <form
        v-if="forgejo.lifecycle !== 'retired'"
        @submit.prevent="rotateForgejo"
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
      <form v-else @submit.prevent="reactivateForgejo">
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
  <p id="forgejo-connection-error" :hidden="!error" role="alert">
    {{ error }}
  </p>
  <dialog
    ref="confirmationDialog"
    aria-labelledby="connection-confirmation-title"
  >
    <form @submit.prevent="lifecycle">
      <h3 id="connection-confirmation-title">
        Confirm {{ confirmation.provider }} Connection change
      </h3>
      <p>
        {{
          confirmation.method === "DELETE"
            ? "This cannot be undone."
            : "Its credential will be destroyed and reactivation requires verification."
        }}
      </p>
      <label
        v-if="confirmation.method === 'DELETE'"
        for="connection-confirmation"
        >Type DELETE to confirm permanent deletion</label
      ><input
        v-if="confirmation.method === 'DELETE'"
        id="connection-confirmation"
        ref="confirmationInput"
        v-model="confirmation.text"
        required
      /><button type="button" @click="confirmationDialog.close()">Cancel</button
      ><button type="submit">Confirm</button>
    </form>
  </dialog>
</template>
