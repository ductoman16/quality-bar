<script setup>
import { computed, nextTick, onMounted, reactive, ref } from "vue";

import {
  csrfToken,
  repositoryCollection,
  responseMessage,
} from "../browser.ts";
import ProviderConnections from "./ProviderConnections.vue";
import RepositoryActions from "./RepositoryActions.vue";
import { validRepository } from "./contract.ts";
import { consumeGitHubCallbackFailure } from "./github-callback.ts";
import { useAlertFocus } from "../useAlertFocus.ts";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const repositories = ref([]);
const loading = ref(true);
const loadFailed = ref(false);
const expanded = reactive(new Set());
const error = ref("");
const providerError = ref("");
const visibleError = computed(() =>
  [...new Set([error.value, providerError.value])].filter(Boolean).join("; "),
);
const errorElement = useAlertFocus(visibleError);
const status = ref("");
const statusElement = ref();
const create = reactive({ token: "", url: "", username: "" });
const counts = computed(() => ({
  disabled: repositories.value.filter(
    ({ lifecycle }) => lifecycle === "disabled",
  ).length,
  enabled: repositories.value.filter(({ lifecycle }) => lifecycle === "enabled")
    .length,
  errors: repositories.value.filter(({ health }) => health === "error").length,
  retired: repositories.value.filter(({ lifecycle }) => lifecycle === "retired")
    .length,
  total: repositories.value.length,
}));
const displayName = (repository) =>
  repository.name ||
  repository.url
    .replace(/\.git$/i, "")
    .split("/")
    .slice(-2)
    .join("/");
async function load(clearError = true, mutationError = "") {
  loading.value = true;
  const previousError = error.value;
  try {
    repositories.value = await repositoryCollection();
    loading.value = false;
    loadFailed.value = false;
    if (clearError && error.value === previousError) error.value = "";
  } catch (failure) {
    loading.value = false;
    repositories.value = [];
    loadFailed.value = true;
    const loadError =
      failure instanceof Error ? failure.message : "Repository listing failed";
    error.value = mutationError ? `${mutationError}; ${loadError}` : loadError;
  }
}
async function register() {
  const body = {
    url: create.url,
    ...((create.username || create.token) && {
      username: create.username,
      token: create.token,
    }),
  };
  try {
    const response = await fetch("/api/v1/repositories", {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(props.csrfCookieName),
      },
      method: "POST",
    });
    if (!response.ok) {
      error.value = await responseMessage(response);
      return;
    }
    const registered = await response.json();
    if (response.status !== 200 || !validRepository(registered)) {
      throw new Error("repository_response_invalid");
    }
    status.value = "Repository registered.";
    create.url = create.username = create.token = "";
    await load();
  } catch (failure) {
    error.value =
      failure instanceof Error
        ? failure.message
        : "Repository registration failed";
  }
}
const changed = async () => {
  status.value = "Repository updated.";
  await load();
};
async function showError(message) {
  providerError.value = "";
  await nextTick();
  providerError.value = message;
}
onMounted(async () => {
  await load();
  const failed = await consumeGitHubCallbackFailure(
    (message) => (error.value = message),
  );
  if (
    !failed &&
    new URLSearchParams(location.search).get("github_connection") ===
      "connected"
  ) {
    status.value = "GitHub Connection connected.";
    await nextTick();
    statusElement.value?.focus();
  }
});
</script>

<template>
  <section
    v-if="!loading && !loadFailed"
    class="repo-overview"
    aria-label="Repository overview"
  >
    <div class="repo-stat-strip">
      <div
        v-for="[label, value] in [
          ['Repositories', counts.total],
          ['Enabled', counts.enabled],
          ['Disabled', counts.disabled],
          ['Retired', counts.retired],
          ['Health errors', counts.errors],
        ]"
        :key="label"
        class="repo-stat"
      >
        <span>{{ label }}</span
        ><output>{{ value }}</output>
      </div>
    </div>
  </section>
  <section
    class="qb-region repo-inventory"
    aria-labelledby="repository-inventory-title"
  >
    <h2 id="repository-inventory-title">Repository inventory</h2>
    <p v-if="loading">Loading repositories</p>
    <p v-if="!loading && !loadFailed && !repositories.length">
      No repositories registered yet.
    </p>
    <article
      v-for="repository in loading || loadFailed ? [] : repositories"
      :id="`repository-${repository.id}`"
      :key="repository.id"
      class="repo-row"
      :data-health="repository.health"
      :data-lifecycle="repository.lifecycle"
    >
      <div class="repo-row__summary">
        <button
          type="button"
          :aria-expanded="expanded.has(repository.id)"
          :aria-label="`${expanded.has(repository.id) ? 'Collapse' : 'Expand'} repository ${displayName(repository)}`"
          @click="
            expanded.has(repository.id)
              ? expanded.delete(repository.id)
              : expanded.add(repository.id)
          "
        >
          ›
        </button>
        <a
          class="repo-row__name"
          :href="`/?view=repository-detail&repository_id=${encodeURIComponent(repository.id)}`"
          >{{ displayName(repository) }}</a
        >
        <span>{{ repository.provider || "HTTPS Git" }}</span
        ><span>{{ repository.lifecycle }}</span
        ><span>{{
          repository.health === "error"
            ? repository.health_error?.message
            : "healthy"
        }}</span
        ><span>{{ repository.assignment_count ?? "—" }}</span>
      </div>
      <div v-if="expanded.has(repository.id)" class="repo-row__detail">
        <dl>
          <dt>Clone URL</dt>
          <dd>{{ repository.url }}</dd>
          <dt>Credential</dt>
          <dd>{{ repository.credential_type }}</dd>
          <template v-if="repository.web_url"
            ><dt>Web URL</dt>
            <dd>{{ repository.web_url }}</dd></template
          >
        </dl>
        <RepositoryActions
          :csrf-cookie-name="csrfCookieName"
          :repository="repository"
          @changed="changed"
          @error="error = $event"
          @refresh="load(false, $event)"
        />
      </div>
    </article>
  </section>
  <details class="repo-add">
    <summary class="repo-add__summary">Add repository</summary>
    <section class="qb-region">
      <h2>Register HTTPS repository</h2>
      <form @submit.prevent="register">
        <label for="repository-url">HTTPS URL</label
        ><input
          id="repository-url"
          v-model="create.url"
          required
          type="url"
        /><label for="repository-username">Username</label
        ><input
          id="repository-username"
          v-model="create.username"
          autocomplete="off"
        /><label for="repository-token">Token</label
        ><input
          id="repository-token"
          v-model="create.token"
          autocomplete="off"
          type="password"
        /><button class="qb-btn qb-btn--primary" type="submit">
          Register Repository
        </button>
      </form>
    </section>
    <ProviderConnections
      :csrf-cookie-name="csrfCookieName"
      @changed="load"
      @error="showError"
    />
  </details>
  <output ref="statusElement" aria-live="polite" tabindex="-1">{{
    status
  }}</output>
  <p
    id="repository-error"
    ref="errorElement"
    :hidden="!visibleError"
    role="alert"
    tabindex="-1"
  >
    {{ visibleError }}
  </p>
</template>
