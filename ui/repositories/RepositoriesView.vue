<script setup>
import { computed, nextTick, onMounted, reactive, ref } from "vue";

import {
  csrfToken,
  repositoryCollection,
  responseMessage,
} from "../browser.js";
import ProviderConnections from "./ProviderConnections.vue";
import RepositoryActions from "./RepositoryActions.vue";
import { consumeGitHubCallbackFailure } from "./github-callback.js";
import { useAlertFocus } from "../useAlertFocus.js";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const repositories = ref([]);
const expanded = reactive(new Set());
const error = ref("");
const errorElement = useAlertFocus(error);
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
async function load() {
  try {
    repositories.value = await repositoryCollection();
    error.value = "";
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : "Repository listing failed";
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
  create.username = create.token = "";
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
    status.value = "Repository registered.";
    create.url = "";
    await load();
  } catch {
    error.value = "Repository registration failed";
  }
}
const changed = async () => {
  status.value = "Repository updated.";
  await load();
};
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
  <section class="repo-overview" aria-label="Repository overview">
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
    <p v-if="!repositories.length">No repositories registered yet.</p>
    <article
      v-for="repository in repositories"
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
      @error="error = $event"
    />
  </details>
  <output ref="statusElement" aria-live="polite" tabindex="-1">{{
    status
  }}</output>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
    {{ error }}
  </p>
</template>
