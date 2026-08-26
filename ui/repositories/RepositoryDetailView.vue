<script setup>
import { onMounted, ref } from "vue";

import { repositoryCollection, requireStatus } from "../browser.ts";
import { useAlertFocus } from "../useAlertFocus.ts";
import RepositoryActions from "./RepositoryActions.vue";
import { validGuidance } from "./contract.ts";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const repository = ref();
const guidance = ref();
const error = ref("");
const errorElement = useAlertFocus(error);
const id = new URLSearchParams(location.search).get("repository_id");
async function load(mutationError = "") {
  if (!id) {
    error.value = "Repository was not specified";
    return;
  }
  try {
    repository.value = (await repositoryCollection()).find(
      (item) => item.id === id,
    );
    if (!repository.value) {
      guidance.value = undefined;
      error.value = mutationError || "Repository was not found";
      return;
    }
    const response = await fetch(
      `/api/v1/repositories/${encodeURIComponent(id)}/guidance`,
    );
    await requireStatus(response, 200, "repository_guidance_response_invalid");
    const body = await response.json();
    if (
      !validGuidance(body) ||
      body.repository.id !== repository.value.id ||
      body.repository.url !== repository.value.url
    ) {
      throw new Error("repository_guidance_invalid");
    }
    guidance.value = body;
  } catch (failure) {
    repository.value = guidance.value = undefined;
    const loadError =
      failure instanceof Error ? failure.message : "Repository failed to load";
    error.value = mutationError ? `${mutationError}; ${loadError}` : loadError;
  }
}
async function changed(value) {
  if (value === null) location.assign("/?view=repositories");
  else await load();
}
onMounted(load);
</script>

<template>
  <section class="qb-region repo-detail">
    <a class="qb-back" href="/?view=repositories">Repositories</a>
    <template v-if="repository"
      ><div class="repo-detail__head">
        <h2>{{ repository.name || repository.url }}</h2>
        <span>{{ repository.lifecycle }} · {{ repository.health }}</span>
      </div>
      <dl class="repo-detail__meta">
        <dt>Provider</dt>
        <dd>{{ repository.provider || "Generic HTTPS Git" }}</dd>
        <dt>Clone URL</dt>
        <dd>{{ repository.url }}</dd>
        <dt>Credential</dt>
        <dd>{{ repository.credential_type }}</dd>
        <dt>Assignments</dt>
        <dd>{{ repository.assignment_count ?? "—" }}</dd>
        <dt>Health</dt>
        <dd>{{ repository.health_error?.message || repository.health }}</dd>
      </dl>
      <RepositoryActions
        :csrf-cookie-name="csrfCookieName"
        :repository="repository"
        @changed="changed"
        @error="error = $event"
        @refresh="load"
      />
      <section class="qb-region qb-deep-surface">
        <h2>Applicable reviews</h2>
        <p v-if="!guidance?.reviews?.length">
          No reviews apply to this repository.
        </p>
        <ol class="repo-guidance">
          <li v-for="review in guidance?.reviews" :key="review.id">
            <strong>{{ review.name }}</strong>
            <span>
              v{{ review.active_version.number }} ·
              {{
                review.criteria.filter(({ impact }) => impact === "blocking")
                  .length
              }}
              blocking ·
              {{
                review.criteria.filter(({ impact }) => impact === "advisory")
                  .length
              }}
              advisory ·
              {{
                review.applicability.type === "unconditional"
                  ? "always applies"
                  : "conditional"
              }}
              · {{ review.assignment.scope.replaceAll("_", " ") }}
            </span>
            <ol>
              <li v-for="criterion in review.criteria" :key="criterion.id">
                {{ criterion.impact }} · {{ criterion.instruction }}
              </li>
            </ol>
          </li>
        </ol>
        <details>
          <summary>Raw guidance document</summary>
          <pre>{{ JSON.stringify(guidance, null, 2) }}</pre>
        </details>
      </section>
    </template>
    <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
      {{ error }}
    </p>
  </section>
</template>
