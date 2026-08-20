<script setup>
import { nextTick, ref } from "vue";

import { csrfRequest, responseMessage } from "../browser.js";
import { validRepository } from "./contract.js";

const props = defineProps({
  csrfCookieName: { required: true, type: String },
  repository: { required: true, type: Object },
});
const emit = defineEmits(["changed", "error", "refresh"]);
const credentialOpen = ref(false);
const username = ref("");
const token = ref("");
const confirmation = ref("");
const dialog = ref();
const confirmationInput = ref();
const deleteTrigger = ref();
const busy = ref(false);
const identity = () =>
  ["github", "forgejo"].includes(props.repository.provider)
    ? `${props.repository.provider === "github" ? "GitHub" : "Forgejo"} Repository ${props.repository.forge_repository_id} on Connection ${props.repository.forge_connection_id}`
    : props.repository.url;
const request = (path, body, method) =>
  csrfRequest(props.csrfCookieName, path, body, method);
function reconcile(message) {
  emit("error", message);
  emit("refresh");
}
async function mutation(path, body, method, fallback) {
  busy.value = true;
  try {
    const response = await request(path, body, method);
    if (method === "DELETE") {
      if (!response.ok) {
        emit("error", await responseMessage(response));
        emit("refresh");
        return;
      }
      if (response.status !== 200 || (await response.json()) !== null) {
        reconcile(`${fallback} response is invalid`);
        return;
      }
      emit("changed", null);
      return;
    }
    if (!response.ok) {
      emit("error", await responseMessage(response));
      if (method === "PATCH") emit("refresh");
      return;
    }
    const value = await response.json();
    if (
      response.status !== 200 ||
      !validRepository(value) ||
      value.id !== props.repository.id ||
      (method === "PATCH" && value.lifecycle !== body.lifecycle)
    ) {
      reconcile(`${fallback} response is invalid`);
      return;
    }
    emit("changed", value);
  } catch (failure) {
    reconcile(
      failure instanceof Error && !(failure instanceof TypeError)
        ? failure.message
        : fallback,
    );
  } finally {
    busy.value = false;
  }
}
async function lifecycle(value) {
  const consequence = {
    disabled: "New work will be rejected; already-created work may finish.",
    enabled:
      "Complete current verification must succeed before new work is accepted.",
    retired: "Repository-bound credentials will be destroyed.",
  }[value];
  if (
    !confirm(
      `${value[0].toUpperCase() + value.slice(1)} ${identity()}? ${consequence}`,
    )
  )
    return;
  await mutation(
    `/api/v1/repositories/${encodeURIComponent(props.repository.id)}/lifecycle`,
    { lifecycle: value },
    "PATCH",
    "Repository lifecycle change failed",
  );
}
async function rotate() {
  await mutation(
    `/api/v1/repositories/${encodeURIComponent(props.repository.id)}/credential/rotate`,
    { token: token.value, username: username.value },
    "POST",
    "Repository credential rotation failed",
  );
  username.value = token.value = "";
  credentialOpen.value = false;
}
async function openDelete() {
  confirmation.value = "";
  dialog.value.showModal();
  await nextTick();
  confirmationInput.value.focus();
}
function cancelDelete() {
  dialog.value.close();
  deleteTrigger.value?.focus();
}
async function remove() {
  if (confirmation.value !== identity()) {
    emit("error", "Type the Repository identity to confirm permanent deletion");
    confirmationInput.value.focus();
    return;
  }
  dialog.value.close();
  await mutation(
    `/api/v1/repositories/${encodeURIComponent(props.repository.id)}`,
    {},
    "DELETE",
    "Repository deletion failed",
  );
}
</script>

<template>
  <div class="repo-actions">
    <button
      v-for="state in ['enabled', 'disabled', 'retired'].filter(
        (state) => state !== repository.lifecycle,
      )"
      :key="state"
      :disabled="busy"
      type="button"
      @click="lifecycle(state)"
    >
      {{ state[0].toUpperCase() + state.slice(1) }}
    </button>
    <button
      v-if="repository.credential_type === 'username_token'"
      type="button"
      @click="credentialOpen = !credentialOpen"
    >
      Rotate credential
    </button>
    <button
      v-if="repository.deletion_eligible"
      ref="deleteTrigger"
      class="repo-danger"
      type="button"
      @click="openDelete"
    >
      Delete
    </button>
    <form
      v-if="credentialOpen"
      class="repo-credential"
      @submit.prevent="rotate"
    >
      <label :for="`repository-username-${repository.id}`"
        >Replacement username</label
      ><input
        :id="`repository-username-${repository.id}`"
        v-model="username"
        autocomplete="off"
        required
      />
      <label :for="`repository-token-${repository.id}`">Replacement token</label
      ><input
        :id="`repository-token-${repository.id}`"
        v-model="token"
        autocomplete="off"
        required
        type="password"
      />
      <button :disabled="busy" type="submit">Save credential</button>
    </form>
  </div>
  <dialog
    ref="dialog"
    aria-labelledby="repository-delete-title"
    @cancel.prevent="cancelDelete"
  >
    <form @submit.prevent="remove">
      <h2 id="repository-delete-title">Delete Repository permanently</h2>
      <p>Delete {{ identity() }} permanently. This cannot be undone.</p>
      <label :for="`repository-delete-${repository.id}`"
        >Repository identity</label
      ><input
        :id="`repository-delete-${repository.id}`"
        ref="confirmationInput"
        v-model="confirmation"
        autocomplete="off"
        required
      />
      <button type="button" @click="cancelDelete">Cancel</button
      ><button class="qb-btn qb-btn--primary" :disabled="busy" type="submit">
        Delete permanently
      </button>
    </form>
  </dialog>
</template>
