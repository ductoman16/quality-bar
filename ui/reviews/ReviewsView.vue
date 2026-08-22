<script setup>
import { computed, onMounted, reactive, ref } from "vue";

import { csrfRequest, requireStatus, responseMessage } from "../browser.js";
import { useAlertFocus } from "../useAlertFocus.js";
import {
  readModelCatalog,
  readReviewCollection,
  matchesReviewVersion,
  validReview,
  validReviewChange,
} from "./contract.js";
import ReviewEditor from "./ReviewEditor.vue";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const reviews = ref([]);
const loading = ref(true);
const loadFailed = ref(false);
const models = ref([]);
const state = ref("active");
const expanded = reactive(new Set());
const dependencyError = ref("");
const error = ref("");
const visibleError = computed(() =>
  [...new Set([dependencyError.value, error.value])].filter(Boolean).join("; "),
);
const errorElement = useAlertFocus(visibleError);
const status = ref("");
const identity = reactive({ description: "", name: "" });
const active = computed(() =>
  reviews.value.filter(
    (review) => review.archived === (state.value === "archived"),
  ),
);
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
async function list(path) {
  const response = await fetch(path);
  await requireStatus(response, 200, "review_collection_response_invalid");
  return readReviewCollection(await response.json());
}
async function load(clearError = true) {
  loading.value = true;
  try {
    reviews.value = await list(
      `/api/v1/reviews${state.value === "archived" ? "?state=archived" : ""}`,
    );
    loading.value = false;
    loadFailed.value = false;
    if (clearError) error.value = "";
    return true;
  } catch (failure) {
    loading.value = false;
    loadFailed.value = true;
    error.value =
      failure instanceof Error ? failure.message : "Reviews failed to load";
    return false;
  }
}
async function create(snapshot) {
  if (!identity.name || !identity.description) {
    error.value = "Review name and description are required";
    return;
  }
  try {
    const response = await request(
      "/api/v1/reviews",
      {
        ...snapshot,
        ...(snapshot.applicability_rule === null
          ? {}
          : { applicability_rule: snapshot.applicability_rule }),
        assignment: { scope: "installation_wide" },
        description: identity.description,
        name: identity.name,
      },
      "POST",
    );
    if (!response.ok) throw new Error(await responseMessage(response));
    if (response.status !== 201)
      throw new Error("Review creation response is invalid");
    const review = await response.json();
    if (
      !validReview(review) ||
      review.name !== identity.name ||
      review.description !== identity.description ||
      review.archived ||
      review.assignment.scope !== "installation_wide" ||
      !matchesReviewVersion(review.active_version, snapshot)
    )
      throw new Error("Review creation response is invalid");
    status.value = `${review.name} v${review.active_version.number} created.`;
    identity.name = identity.description = "";
    await load();
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : "Review creation failed";
  }
}
async function archive(review) {
  const archived = !review.archived;
  if (
    !confirm(
      archived
        ? `Archive Review "${review.name}"? It will be excluded from new Evaluations.`
        : `Restore Review "${review.name}"?`,
    )
  )
    return;
  try {
    const response = await request(
      `/api/v1/reviews/${encodeURIComponent(review.id)}/archival`,
      { archived },
      "PATCH",
    );
    if (!response.ok) throw new Error(await responseMessage(response));
    if (response.status !== 200)
      throw new Error("Review lifecycle response is invalid");
    const value = await response.json();
    if (
      !validReviewChange(value) ||
      value.review.id !== review.id ||
      value.review.archived !== archived
    ) {
      throw new Error("Review lifecycle response is invalid");
    }
    const authoritative = await list(
      `/api/v1/reviews${archived ? "?state=archived" : ""}`,
    );
    if (
      !authoritative.some(
        (item) => item.id === review.id && item.archived === archived,
      )
    ) {
      throw new Error("Review lifecycle result is unavailable");
    }
    await load();
    status.value = `${review.name} ${archived ? "archived" : "restored"}.`;
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "Review lifecycle failed";
    const loaded = await load(false);
    error.value = loaded ? message : `${message}; ${error.value}`;
  }
}
onMounted(async () => {
  try {
    const response = await fetch("/api/v1/system");
    await requireStatus(response, 200, "system_response_invalid");
    models.value = readModelCatalog(await response.json());
    dependencyError.value = "";
  } catch (failure) {
    dependencyError.value =
      failure instanceof Error
        ? failure.message
        : "Codex model catalog failed to load";
  }
  await load();
});
</script>

<template>
  <details class="reviews-authoring">
    <summary>New Review</summary>
    <div>
      <label for="review-name">Name</label
      ><input id="review-name" v-model="identity.name" required /><label
        for="review-description"
        >Description</label
      ><textarea
        id="review-description"
        v-model="identity.description"
        required
      ></textarea
      ><ReviewEditor
        v-if="models.length"
        :models="models"
        submit-label="Create Review"
        @save="create"
      />
    </div>
  </details>
  <section class="qb-region">
    <h2 class="qb-visually-hidden">Configured Reviews</h2>
    <p v-if="loading">Loading Reviews</p>
    <output v-if="!loading && !loadFailed" aria-live="polite"
      >{{ active.length }} {{ state }} Reviews</output
    >
    <div class="reviews-catalog__filter" role="group" aria-label="Review state">
      <button
        v-for="value in ['active', 'archived']"
        :key="value"
        :aria-pressed="state === value"
        type="button"
        @click="
          state = value;
          load();
        "
      >
        {{ value[0].toUpperCase() + value.slice(1) }}
      </button>
    </div>
    <p v-if="!loading && !loadFailed && !active.length">
      No Reviews configured
    </p>
    <article
      v-for="review in loading || loadFailed ? [] : active"
      :key="review.id"
      class="review-row"
    >
      <div class="review-row__summary">
        <button
          type="button"
          :aria-expanded="expanded.has(review.id)"
          :aria-label="`Expand Review ${review.name}`"
          @click="
            expanded.has(review.id)
              ? expanded.delete(review.id)
              : expanded.add(review.id)
          "
        >
          ›</button
        ><a
          :href="`/?view=review-detail&review_id=${encodeURIComponent(review.id)}`"
          ><strong>{{ review.name }}</strong></a
        ><span>{{ review.assignment?.scope?.replaceAll("_", " ") }}</span
        ><span>{{ review.active_version.criteria.length }} criteria</span
        ><span>v{{ review.active_version.number }}</span
        ><span>{{ review.active_version.codex_configuration.model }}</span>
      </div>
      <div v-if="expanded.has(review.id)" class="review-expanded">
        <p>{{ review.description }}</p>
        <ol>
          <li
            v-for="criterion in review.active_version.criteria"
            :key="criterion.id"
          >
            <strong>{{ criterion.impact }}</strong> ·
            {{ criterion.instruction }}
          </li>
        </ol>
        <button v-if="review.archived" type="button" @click="archive(review)">
          Restore</button
        ><a
          :href="`/?view=review-detail&review_id=${encodeURIComponent(review.id)}`"
          >Open Review</a
        >
      </div>
    </article>
  </section>
  <output aria-live="polite">{{ status }}</output>
  <p v-if="visibleError" ref="errorElement" role="alert" tabindex="-1">
    {{ visibleError }}
  </p>
</template>
