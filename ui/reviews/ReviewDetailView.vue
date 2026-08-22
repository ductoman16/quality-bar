<script setup>
import { nextTick, onMounted, reactive, ref } from "vue";
import {
  csrfRequest,
  repositoryCollection,
  requireStatus,
  responseMessage,
} from "../browser.js";
import { useAlertFocus } from "../useAlertFocus.js";
import {
  matchesReviewVersion,
  readModelCatalog,
  readReviewCollection,
  validReview,
  validReviewChange,
} from "./contract.js";
import ReviewEditor from "./ReviewEditor.vue";
const props = defineProps({ csrfCookieName: { required: true, type: String } });
const id = new URLSearchParams(location.search).get("review_id");
const review = ref(),
  repositories = ref([]),
  models = ref([]),
  error = ref("");
const errorElement = useAlertFocus(error);
const status = ref("");
const metadata = reactive({ description: "", name: "" });
const assignment = reactive({ repositoryIds: [], scope: "installation_wide" });
const deleteDialog = ref();
const deleteInput = ref();
const deleteTrigger = ref();
const deleteName = ref("");
const deleteError = ref("");
const selectedVersionId = ref("");
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
const fail = (error, fallback) =>
  error instanceof Error ? error.message : fallback;
async function list(path) {
  const response = await fetch(path);
  await requireStatus(response, 200, "review_collection_response_invalid");
  return readReviewCollection(await response.json());
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
  const value = await findReview();
  if (!value) error.value = "Review was not found";
  else open(value);
}
async function findReview() {
  return [
    ...(await list("/api/v1/reviews")),
    ...(await list("/api/v1/reviews?state=archived")),
  ].find((item) => item.id === id);
}
async function save(path, body, method, fallback) {
  try {
    const response = await request(path, body, method);
    if (!response.ok) {
      error.value = await responseMessage(response);
      return null;
    }
    if (response.status !== 200) {
      error.value = "Review response is invalid";
      return null;
    }
    const value = await response.json();
    error.value = "";
    return value;
  } catch (failure) {
    error.value = fail(failure, fallback);
    return null;
  }
}
function requireReview(value, changed = false, requested = () => true) {
  const candidate = changed ? value?.review : value;
  if (
    !(changed ? validReviewChange(value) : validReview(value)) ||
    candidate.id !== id ||
    !requested(candidate)
  ) {
    error.value = "Review response is invalid";
    return null;
  }
  return candidate;
}
async function saveMetadata() {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/metadata`,
    metadata,
    "PATCH",
    "Review metadata failed to save",
  );
  if (!value) return;
  const next = requireReview(
    value,
    false,
    (item) =>
      item.name === metadata.name && item.description === metadata.description,
  );
  if (!next) return;
  open(next);
  status.value = `${next.name} metadata saved.`;
}
async function saveVersion(snapshot) {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/versions`,
    snapshot,
    "POST",
    "Review Version failed to save",
  );
  if (!value) return;
  const next = requireReview(value, true, (item) =>
    matchesReviewVersion(item.active_version, snapshot),
  );
  if (!next) return;
  open(next);
  status.value = `${next.name} v${next.active_version.number} ${value.changed ? "active" : "unchanged"}.`;
}
async function activateVersion() {
  const value = await save(
    `/api/v1/reviews/${encodeURIComponent(id)}/active-version`,
    { review_version_id: selectedVersionId.value },
    "PATCH",
    "Review Version failed to reactivate",
  );
  if (!value) return;
  const next = requireReview(
    value,
    true,
    (item) => item.active_version.id === selectedVersionId.value,
  );
  if (next) open(next);
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
  if (!value) return;
  const next = requireReview(
    value,
    true,
    (item) =>
      item.assignment.scope === body.scope &&
      JSON.stringify(item.assignment.repository_ids ?? []) ===
        JSON.stringify(body.repository_ids ?? []),
  );
  if (!next) return;
  open(next);
  status.value = value.changed ? "Assignment saved." : "Assignment unchanged.";
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
  const next = value
    ? requireReview(value, true, (item) => item.archived === archived)
    : null;
  let authoritative;
  try {
    authoritative = await findReview();
  } catch (failure) {
    error.value = `${error.value || "Review lifecycle failed"}; ${fail(failure, "Review refresh failed")}`;
    return;
  }
  if (!value) {
    if (authoritative) open(authoritative);
    else review.value = undefined;
    return;
  }
  if (!next || authoritative?.archived !== archived) {
    error.value = "Review lifecycle result is unavailable";
    return;
  }
  error.value = "";
  open(authoritative);
  status.value = `${authoritative.name} ${archived ? "archived" : "restored"}.`;
}
async function openDelete() {
  deleteName.value = "";
  deleteError.value = "";
  deleteDialog.value.showModal();
  await nextTick();
  deleteInput.value.focus();
}
function cancelDelete() {
  deleteDialog.value.close();
  deleteTrigger.value?.focus();
}
async function remove() {
  if (deleteName.value !== review.value.name) {
    deleteError.value = "Type the Review name to confirm permanent deletion";
    deleteInput.value.focus();
    return;
  }
  deleteDialog.value.close();
  let mutationError = "";
  try {
    const response = await request(
      `/api/v1/reviews/${encodeURIComponent(id)}`,
      {},
      "DELETE",
    );
    if (!response.ok) {
      mutationError = await responseMessage(response);
    } else if (response.status !== 200 || (await response.json()) !== null) {
      mutationError = "Review deletion response is invalid";
    } else {
      location.assign("/?view=reviews");
      return;
    }
  } catch (failure) {
    mutationError = fail(failure, "Review deletion failed");
  }
  try {
    const current = await findReview();
    if (current) open(current);
    else review.value = undefined;
    error.value = mutationError;
  } catch (failure) {
    error.value = `${mutationError}; ${fail(failure, "Review deletion reconciliation failed")}`;
  }
}
onMounted(async () => {
  try {
    const [systemResponse, repositoryItems] = await Promise.all([
      fetch("/api/v1/system"),
      repositoryCollection(),
    ]);
    await requireStatus(systemResponse, 200, "system_response_invalid");
    models.value = readModelCatalog(await systemResponse.json());
    repositories.value = repositoryItems;
    await load();
  } catch (failure) {
    error.value = fail(failure, "Review dependencies failed to load");
  }
});
</script>
<template>
  <section v-if="review" class="qb-region review-detail">
    <a class="qb-back" href="/?view=reviews">Reviews</a>
    <div class="review-detail__head">
      <h2>{{ review.name }}</h2>
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
          ref="deleteTrigger"
          type="button"
          @click="openDelete"
        >
          Delete Review
        </button>
      </div>
    </section>
    <output aria-live="polite">{{ status }}</output>
  </section>
  <dialog
    ref="deleteDialog"
    aria-labelledby="review-delete-title"
    @cancel.prevent="cancelDelete"
  >
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
      />
      <p v-if="deleteError" role="alert">{{ deleteError }}</p>
      <button type="button" @click="cancelDelete">Cancel</button
      ><button type="submit">Delete permanently</button>
    </form>
  </dialog>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
    {{ error }}
  </p>
</template>
