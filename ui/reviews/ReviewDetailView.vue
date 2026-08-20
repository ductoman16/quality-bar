<script setup>
import { nextTick, onMounted, reactive, ref } from "vue";

import {
  csrfToken,
  repositoryCollection,
  responseMessage,
} from "../browser.js";
import { useAlertFocus } from "../useAlertFocus.js";
import ReviewEditor from "./ReviewEditor.vue";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const id = new URLSearchParams(location.search).get("review_id");
const review = ref();
const repositories = ref([]);
const models = ref([]);
const error = ref("");
const errorElement = useAlertFocus(error);
const status = ref("");
const metadata = reactive({ description: "", name: "" });
const assignment = reactive({ repositoryIds: [], scope: "installation_wide" });
const deleteDialog = ref();
const deleteInput = ref();
const deleteName = ref("");
const selectedVersionId = ref("");
const request = (path, body, method) =>
  fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(props.csrfCookieName),
    },
    method,
  });
async function list(path) {
  const response = await fetch(path);
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body.reviews) ? body.reviews : [];
}
function open(value) {
  review.value = value;
  metadata.name = value.name;
  metadata.description = value.description;
  assignment.scope = value.assignment.scope;
  assignment.repositoryIds = [...(value.assignment.repository_ids ?? [])];
  selectedVersionId.value = value.active_version.id;
}
async function load() {
  if (!id) {
    error.value = "Review was not specified";
    return;
  }
  const value = [
    ...(await list("/api/v1/reviews")),
    ...(await list("/api/v1/reviews?state=archived")),
  ].find((item) => item.id === id);
  if (!value) error.value = "Review was not found";
  else open(value);
}
async function save(path, body, method, fallback) {
  const response = await request(path, body, method);
  if (!response.ok) {
    error.value = await responseMessage(response, fallback);
    return null;
  }
  error.value = "";
  return response.status === 204 ? null : response.json();
}
async function saveMetadata() {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/metadata`,
    metadata,
    "PATCH",
    "Review metadata failed to save",
  );
  if (value) {
    open(value);
    status.value = `${value.name} metadata saved.`;
  }
}
async function saveVersion(snapshot) {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/versions`,
    snapshot,
    "POST",
    "Review Version failed to save",
  );
  if (value?.review) {
    open(value.review);
    status.value = `${value.review.name} v${value.review.active_version.number} ${value.changed ? "active" : "unchanged"}.`;
  }
}
async function activateVersion() {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/active-version`,
    { review_version_id: selectedVersionId.value },
    "PATCH",
    "Review Version failed to reactivate",
  );
  if (value?.review) open(value.review);
}
async function saveAssignment() {
  const body =
    assignment.scope === "installation_wide"
      ? { scope: assignment.scope }
      : {
          repository_ids: [...assignment.repositoryIds].sort(),
          scope: assignment.scope,
        };
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/assignment`,
    body,
    "PATCH",
    "Review Assignment failed to save",
  );
  if (value?.review) {
    open(value.review);
    status.value = value.changed
      ? "Assignment saved."
      : "Assignment unchanged.";
  }
}
async function archive() {
  const archived = !review.value.archived;
  if (
    !confirm(
      archived
        ? `Archive Review "${review.value.name}"? It will be excluded from new Evaluations.`
        : `Restore Review "${review.value.name}"?`,
    )
  )
    return;
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/archival`,
    { archived },
    "PATCH",
    "Review lifecycle failed",
  );
  if (value?.review) {
    open(value.review);
    status.value = `${value.review.name} ${archived ? "archived" : "restored"}.`;
  }
}
async function openDelete() {
  deleteName.value = "";
  deleteDialog.value.showModal();
  await nextTick();
  deleteInput.value.focus();
}
async function remove() {
  if (deleteName.value !== review.value.name) {
    error.value = "Type the Review name to confirm permanent deletion";
    deleteInput.value.focus();
    return;
  }
  deleteDialog.value.close();
  const response = await request(
    `/api/v1/reviews/${encodeURIComponent(id)}`,
    {},
    "DELETE",
  );
  if (response.ok) location.assign("/?view=reviews");
  else error.value = await responseMessage(response, "Review deletion failed");
}
onMounted(async () => {
  try {
    const [systemResponse, repositoryItems] = await Promise.all([
      fetch("/api/v1/system"),
      repositoryCollection(),
    ]);
    if (!systemResponse.ok) {
      throw new Error(
        await responseMessage(
          systemResponse,
          "Review dependencies failed to load",
        ),
      );
    }
    const catalog = (await systemResponse.json()).codex?.catalog?.models;
    if (!Array.isArray(catalog)) {
      throw new Error("review_dependencies_invalid");
    }
    models.value = catalog;
    repositories.value = repositoryItems;
    await load();
  } catch (failure) {
    error.value =
      failure instanceof Error
        ? failure.message
        : "Review dependencies failed to load";
  }
});
</script>

<template>
  <section v-if="review" class="qb-region review-detail">
    <a class="qb-back" href="/?view=reviews">Reviews</a>
    <div class="review-detail__head">
      <h1>{{ review.name }}</h1>
      <span>{{ review.archived ? "Archived" : "Active" }}</span>
    </div>
    <section class="review-group qb-deep-surface">
      <h2>Active version · v{{ review.active_version.number }}</h2>
      <ReviewEditor
        :models="models"
        :snapshot="review.active_version"
        submit-label="Save Review Version"
        @save="saveVersion"
      />
      <details>
        <summary>Version history</summary>
        <label for="prior-version">Prior Version</label
        ><select id="prior-version" v-model="selectedVersionId">
          <option
            v-for="version in review.versions"
            :key="version.id"
            :value="version.id"
          >
            v{{ version.number }}
          </option></select
        ><button type="button" @click="activateVersion">Reactivate</button>
      </details>
    </section>
    <section class="review-group">
      <h2>Review</h2>
      <form @submit.prevent="saveMetadata">
        <label for="review-metadata-name">Name</label
        ><input
          id="review-metadata-name"
          v-model="metadata.name"
          required
        /><label for="review-metadata-description">Description</label
        ><textarea
          id="review-metadata-description"
          v-model="metadata.description"
          required
        ></textarea
        ><button type="submit">Save metadata</button>
      </form>
      <form @submit.prevent="saveAssignment">
        <label for="review-assignment-scope">Scope</label
        ><select id="review-assignment-scope" v-model="assignment.scope">
          <option value="installation_wide">Installation-wide</option>
          <option value="repository_set">Repository-specific</option></select
        ><label for="review-assignment-repositories">Repositories</label
        ><select
          id="review-assignment-repositories"
          v-model="assignment.repositoryIds"
          :disabled="assignment.scope === 'installation_wide'"
          multiple
          required
        >
          <option
            v-for="repository in repositories"
            :key="repository.id"
            :value="repository.id"
          >
            {{ repository.url }}
          </option></select
        ><button type="submit">Save Assignment</button>
      </form>
      <div>
        <button type="button" @click="archive">
          {{ review.archived ? "Restore" : "Archive" }}</button
        ><button
          v-if="review.deletion_eligible"
          type="button"
          @click="openDelete"
        >
          Delete Review
        </button>
      </div>
    </section>
    <output aria-live="polite">{{ status }}</output>
  </section>
  <dialog ref="deleteDialog" aria-labelledby="review-delete-title">
    <form @submit.prevent="remove">
      <h2 id="review-delete-title">Delete Review permanently</h2>
      <p>
        Delete Review "{{ review?.name }}" permanently. This cannot be undone.
      </p>
      <label for="review-delete-name">Review name</label
      ><input
        id="review-delete-name"
        ref="deleteInput"
        v-model="deleteName"
        required
      /><button type="button" @click="deleteDialog.close()">Cancel</button
      ><button type="submit">Delete permanently</button>
    </form>
  </dialog>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
    {{ error }}
  </p>
</template>
